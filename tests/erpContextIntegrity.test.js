import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// GUARD for the C98-class bug: the ERP component builds a giant `erpCtx` object of
// SHORTHAND properties ({ setCompanies, ... }). If any shorthand identifier isn't
// actually in ERP scope, the object literal throws a ReferenceError on EVERY render →
// the whole app is down on load. The build doesn't catch it (runtime), and unit tests
// don't mount ERP (no render harness, O14). This statically asserts every erpCtx
// identifier is declared somewhere in App.jsx — the cheap net that catches it.
describe("erpCtx integrity — every context value is a real binding (no undefined refs)", () => {
  const src = fs.readFileSync(path.resolve("src/App.jsx"), "utf8");

  it("erpCtx exists and every shorthand identifier is declared in scope", () => {
    const m = src.match(/const erpCtx = \{([\s\S]*?)\};/);
    expect(m).toBeTruthy();
    const shorthand = m[1].split(",").map(s => s.trim()).filter(t => /^[A-Za-z_$][\w$]*$/.test(t));
    expect(shorthand.length).toBeGreaterThan(100);   // sanity: we parsed the big object

    const isDeclared = (id) => new RegExp(
      "(const\\s+\\{[^}]*\\b" + id + "\\b)" +   // const { ...id... } = ...
      "|(const\\s+\\[[^\\]]*\\b" + id + "\\b)" + // const [ ...id... ] = useState
      "|(const\\s+" + id + "\\b)" +              // const id = ...
      "|(function\\s+" + id + "\\b)" +           // function id(...)
      "|(let\\s+" + id + "\\b)" +
      "|(,\\s*" + id + "\\s*[,})])" +            // a destructure/param member: , id , | , id } | , id )
      "|(\\(\\s*\\{[^)]*\\b" + id + "\\b)",      // ({ id, ... }) param
      "m"
    ).test(src);

    const undefinedRefs = shorthand.filter(id => !isDeclared(id));
    expect(undefinedRefs, `erpCtx references undeclared identifiers (app would crash on load): ${undefinedRefs.join(", ")}`).toEqual([]);
  });

  it("the C98 setters (setCompanies/setCurrentCompany) are threaded into ERP", () => {
    // They live in AppWrapper state; ERP must receive them as props (the bug was the gap).
    expect(/function ERP\(\{[^)]*\bsetCompanies\b/.test(src)).toBe(true);
    expect(/function ERP\(\{[^)]*\bsetCurrentCompany\b/.test(src)).toBe(true);
    expect(/<ERP[\s\S]*?setCompanies=\{setCompanies\}/.test(src)).toBe(true);
  });
});
