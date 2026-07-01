import { describe, it, expect } from "vitest";
import { parse } from "@babel/parser";
import _traverse from "@babel/traverse";
import fs from "fs";
import path from "path";

const traverse = _traverse.default || _traverse;

// Guard for the TEMPORAL-DEAD-ZONE crash class the scope scan does NOT catch:
//   `ReferenceError: Cannot access 'X' before initialization`
// A hook's DEPENDENCY ARRAY (useEffect/useMemo/useCallback/useImperativeHandle/useLayoutEffect)
// is evaluated DURING render, at the call site. If a dep references a `const`/`let` declared
// LATER in the same function/component scope, it hits the TDZ and crashes on mount — while the
// build (no runtime) and the no-undef scope scan (the name IS bound, just not yet) both pass.
// This is the exact bug that took the app down (an auto-post effect above its state's declaration).
//
// Real binding analysis: for every hook-deps identifier, resolve its binding; flag when it's a
// const/let bound in the SAME function as the hook and declared at a LATER source position.

const HOOKS = new Set(["useEffect", "useMemo", "useCallback", "useImperativeHandle", "useLayoutEffect"]);

function srcFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) srcFiles(p, out);
    else if (/\.(jsx?|mjs)$/.test(e.name) && !p.includes(".backup")) out.push(p);
  }
  return out;
}

// Root identifier of a deps element: `a`, `a.b`, `a?.b?.c` → "a".
function rootIdentifier(node) {
  let n = node;
  while (n && (n.type === "MemberExpression" || n.type === "OptionalMemberExpression")) n = n.object;
  return n && n.type === "Identifier" ? n : null;
}

// Returns a list of "hook deps use a const/let declared later in the same scope" offenders.
function findTdzOffenders(code) {
  const ast = parse(code, { sourceType: "module", plugins: ["jsx"] });
  const offenders = [];
  traverse(ast, {
    CallExpression(callPath) {
      const callee = callPath.node.callee;
      const name = callee.type === "Identifier" ? callee.name
        : callee.type === "MemberExpression" && callee.property.type === "Identifier" ? callee.property.name
        : null;
      if (!name || !HOOKS.has(name)) return;
      const args = callPath.node.arguments;
      const deps = args[args.length - 1];
      if (!deps || deps.type !== "ArrayExpression") return;

      const hookFn = callPath.getFunctionParent();
      const hookStart = callPath.node.start;
      for (const el of deps.elements) {
        const id = rootIdentifier(el);
        if (!id) continue;
        const binding = callPath.scope.getBinding(id.name);
        if (!binding) continue;                                          // global / import → fine
        if (binding.kind !== "const" && binding.kind !== "let") continue; // var hoists; params/functions fine
        const bindFn = binding.path.getFunctionParent();
        const sameFn = bindFn && hookFn && bindFn.node === hookFn.node;   // declared in the SAME function
        if (sameFn && binding.identifier.start > hookStart) {
          offenders.push(`${name}([… ${id.name} …]) uses '${id.name}' declared later`);
        }
      }
    },
  });
  return offenders;
}

describe("TDZ-in-hook-deps detector — proves it CATCHES the bug (not a no-op)", () => {
  it("FLAGS a dep that references a const declared later in the same component (the P0 pattern)", () => {
    const bad = `
      function C() {
        useEffect(() => { if (ready) run(); }, [ready]);   // ← ready used here
        const [ready, setReady] = useState(false);          // ← declared later → TDZ
        return null;
      }`;
    expect(findTdzOffenders(bad).length).toBe(1);
  });
  it("does NOT flag when the const is declared BEFORE the hook (the fix)", () => {
    const good = `
      function C() {
        const [ready, setReady] = useState(false);
        useEffect(() => { if (ready) run(); }, [ready]);
        return null;
      }`;
    expect(findTdzOffenders(good)).toEqual([]);
  });
  it("does NOT flag a member-expression dep declared before (currentCompany?.id)", () => {
    const good = `
      function C() {
        const currentCompany = useThing();
        useEffect(() => {}, [currentCompany?.id]);
        return null;
      }`;
    expect(findTdzOffenders(good)).toEqual([]);
  });
});

describe("no temporal-dead-zone in hook dependency arrays across src/ (crash-on-mount guard)", () => {
  const files = srcFiles("src");
  it.each(files)("%s — hook deps never reference a const/let declared later in the same scope", (file) => {
    const offenders = findTdzOffenders(fs.readFileSync(file, "utf8"));
    expect(offenders, `${file} has TDZ-in-hook-deps (would crash on mount): ${offenders.join(" · ")}`).toEqual([]);
  });
});
