import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ── A FUNCTION WITH NO CALLER IS INDISTINGUISHABLE FROM ONE WITH NOTHING TO DO ──
// O137 (C329): the extraction cache's `priorExtraction` and `storeExtraction` were defined
// in App.jsx, pinned by tests that read their BODIES, and called by nothing — for twelve
// days. C331 then found `cashFromBanks` exposed on the context and read by no component,
// computing the one figure §12 says must never be shown as cash. Both are the C195(7)
// shape: mechanism present, trigger absent, and a green suite that cannot tell.
//
// So this asks, of every arrow-declared const inside App.jsx: is it REFERENCED anywhere
// other than its own declaration and the context export line? A name whose only other
// home is `erpCtx` is exposed and unread — the O95 "name the reader" defect in the shape
// of a function.
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");
const APP = strip(fs.readFileSync(path.join(process.cwd(), "src/App.jsx"), "utf8"));

function walk(dir) {
  return fs.readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return fs.statSync(p).isDirectory() ? walk(p) : /\.(js|jsx)$/.test(f) ? [p] : [];
  });
}
// ★ C347 — A VIEW'S `const { … } = useERP()` DESTRUCTURE IS NOT A READER. Every view
// copy-pastes a ~300-name destructure, so a name that appears there and nowhere else is
// exposed and unread exactly as if it were only on `erpCtx`. The first version of this
// guard counted those lines, which is how `filteredInvoices` — computed on every render,
// read by nothing since C335 deleted its one consumer — passed it.
const noDestructure = (t) => t.replace(/const\s*\{[^}]*\}\s*=\s*useERP\(\)\s*;?/g, " ");
const OTHERS = noDestructure(walk(path.join(process.cwd(), "src"))
  .filter((p) => !p.endsWith(path.join("src", "App.jsx")))
  .map((p) => strip(fs.readFileSync(p, "utf8"))).join("\n"));

const ctxStart = APP.indexOf("const erpCtx = {");
const ctxEnd = APP.indexOf("};", ctxStart);
const CTX = APP.slice(ctxStart, ctxEnd);
const APP_SANS_CTX = APP.slice(0, ctxStart) + APP.slice(ctxEnd);

// Arrow-declared consts AND memoised values: `const x = useMemo(() => …)` is a computation
// that runs on every change of its inputs, and one nobody reads is paid for forever.
const declared = [...new Set([
  ...[...APP.matchAll(/^\s+const ([A-Za-z_]\w*) = (?:async )?\(?[^=\n]*\)?\s*=>/gm)].map((m) => m[1]),
  ...[...APP.matchAll(/^\s+const ([A-Za-z_]\w*) = use(?:Memo|Callback)\(/gm)].map((m) => m[1]),
])];
const refs = (name, text) => (text.match(new RegExp(`\\b${name}\\b`, "g")) || []).length;

function unread(app = APP_SANS_CTX, others = OTHERS, names = declared) {
  return names.filter((n) => refs(n, app) <= 1 && refs(n, others) === 0);
}

// ★ C348 — STATE NOBODY READS. `const [x, setX] = useState(…)` whose `x` is referenced
// nowhere but its own declaration is a hook that costs a root re-render on every `setX`
// (C297's cost) and can never change a pixel. The first run found TWENTY — a whole
// QuickBooks-import state set, three reconciliation values, two narration pairs — all
// reset on every company switch and read by nothing since their screens moved to local state.
const stateVars = [...APP.matchAll(/^\s+const \[([A-Za-z_]\w*), *set[A-Za-z_]\w*\] = useState/gm)].map((m) => m[1]);
function unreadState(app = APP_SANS_CTX, others = OTHERS, names = stateVars) {
  return names.filter((n) => refs(n, app) <= 1 && refs(n, others) === 0);
}

describe("every function declared in ERP has a reader", () => {
  it("scans a real population", () => {
    expect(ctxStart).toBeGreaterThan(0);
    expect(declared.length).toBeGreaterThan(200);
  });
  it("★★ no declaration is referenced only by itself and the context export", () => {
    expect(unread()).toEqual([]);
  });
  it("★ the check can fail — a planted unread helper is caught", () => {
    const planted = APP_SANS_CTX + "\n  const plantedHelper = async (x) => x;\n";
    expect(unread(planted, OTHERS, [...declared, "plantedHelper"])).toEqual(["plantedHelper"]);
    // …and exposing it on the context is NOT a reader.
    expect(unread(planted, OTHERS + " ", [...declared, "plantedHelper"])).toEqual(["plantedHelper"]);
    // …and neither is a view destructuring it from useERP() — the C347 blind spot.
    const destructured = OTHERS + "\nconst { plantedHelper, invoices } = useERP();\n";
    expect(unread(planted, noDestructure(destructured), [...declared, "plantedHelper"])).toEqual(["plantedHelper"]);
  });
});

describe("★ C348 — every useState in ERP is READ somewhere, not merely set", () => {
  it("scans a real population", () => { expect(stateVars.length).toBeGreaterThan(80); });
  it("★★ no state value is referenced only by its own declaration", () => {
    expect(unreadState()).toEqual([]);
  });
  it("★ the check can fail — a planted write-only state is caught, and a setter call is not a read", () => {
    const planted = APP_SANS_CTX + "\n  const [plantedFlag, setPlantedFlag] = useState(false);\n  setPlantedFlag(true);\n";
    expect(unreadState(planted, OTHERS, [...stateVars, "plantedFlag"])).toEqual(["plantedFlag"]);
  });
});
