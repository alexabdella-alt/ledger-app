import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// C603 — review finding B8: "already reversed" was returned as success, and its Undo
// deleted the earlier correction.
const app = readFileSync("src/App.jsx", "utf8");
const rev = app.slice(app.indexOf("const reverseJournalEntry = async"), app.indexOf("const { data: orig, error: loadErr }"));
const vd = app.slice(app.indexOf("const voidInvoiceWithUndo = async"), app.indexOf("tap Undo to restore`", app.indexOf("const voidInvoiceWithUndo = async")));

describe("an entry that is already reversed", () => {
  it("★ both checks return { already: true } — never the old correction's id as if new", () => {
    expect(rev).toMatch(/return \{ already: true, id: ex \? resolveEntryDbId\(ex\) : null \};/);
    expect(rev).toMatch(/if \(Array\.isArray\(existing\) && existing\.length\) return \{ already: true, id: existing\[0\]\.id \};/);
    expect(rev).not.toMatch(/return ex \? resolveEntryDbId\(ex\) : true;/);
  });

  it("★ Void says nothing changed and offers NO Undo (the Undo deleted the earlier correction)", () => {
    const already = vd.indexOf("if (revId.already) {");
    expect(already).toBeGreaterThan(-1);
    expect(vd.slice(already, already + 300)).toMatch(/was already removed — nothing changed\.`, "info"\);\s*\n\s*return revId;/);
    expect(already).toBeLessThan(vd.indexOf("showNotification(`Reversed"));
  });

  it("the signed-month path and the assistant say it too", () => {
    expect(app).toMatch(/if \(revId\.already\) \{\s*\/\/ C603\s*\n\s*showNotification\(`\$\{invoice\.vendor \|\| "That entry"\} was already removed — nothing changed\.`, "info"\);\s*\n\s*return \{ ok: true, mode: plan\.mode, already: true, id: revId\.id \};/);
    expect(app).toMatch(/if \(revId && revId\.already\) summary\.push\(`\$\{target\.vendor\} was already undone — nothing changed`\);/);
    expect(app).toMatch(/if \(revId && revId\.already\) summary\.push\(`\$\{toReverse\.vendor\} \(\$\{fmtMoney\(toReverse\.amount\)\}\) was already undone — nothing changed`\);/);
    expect(app).toMatch(/if \(revId && !revId\.already\) voided\+\+;/);
  });
});
