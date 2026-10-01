import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ═════════════════════════════════════════════════════════════════════════════
// C560 — ONE WORD FOR THE PEOPLE YOU BUY FROM: "vendor" (C495's open item, settled).
// The sidebar said Vendors, the screen it opened said suppliers, Settings said Supplier rules,
// the reports said By Vendor. One vocabulary is the rule (C320). "Vendor" because it is the US
// standard — QuickBooks, Bill.com and the IRS's 1099 material all use it — and it was already
// the word on the sidebar and the reports, so it is the smaller change for the reader.
//
// ★ THIS GUARD READS TEXT A PERSON SEES — string literals and JSX text — not comments or code
// names. One exception, named: chatActions accepts "supplier" FROM THE AI as a contact type,
// which is input the app understands, not a word it shows.
// ═════════════════════════════════════════════════════════════════════════════

const ROOT = path.join(process.cwd(), "src");
const files = [];
(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (/\.(jsx?|tsx?)$/.test(f)) files.push(p);
  }
})(ROOT);

const VISIBLE = /"[^"\n]*\bsuppliers?\b[^"\n]*"|'[^'\n]*\bsuppliers?\b[^'\n]*'|`[^`\n]*\bsuppliers?\b[^`\n]*`|>[^<\n]*\bsuppliers?\b[^<\n]*</i;
const ALLOWED = [/chatActions\.js$/];   // accepts "supplier" as input from the model

describe("C560 — one word on screen: vendor", () => {
  it("★★ no string or screen text says 'supplier'", () => {
    const hits = [];
    for (const p of files) {
      if (ALLOWED.some((re) => re.test(p))) continue;
      fs.readFileSync(p, "utf8").split("\n").forEach((line, i) => {
        const t = line.trim();
        if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.startsWith("{/*")) return;
        const code = line.replace(/\/\/.*$/, "");   // a trailing comment is not screen text
        if (VISIBLE.test(code)) hits.push(`${path.relative(process.cwd(), p)}:${i + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });
  it("the renamed places say vendor", () => {
    const nav = fs.readFileSync(path.join(ROOT, "lib/nav.js"), "utf8");
    expect(nav).toMatch(/\["rules", "Vendor rules"\]/);
    const books = fs.readFileSync(path.join(ROOT, "components/views/BooksView.jsx"), "utf8");
    expect(books).toMatch(/placeholder="Search vendor, amount, date, invoice number…"/);
  });
  it("★ and the AI may still say 'supplier' — the app understands it as a vendor", () => {
    const actions = fs.readFileSync(path.join(ROOT, "lib/chatActions.js"), "utf8");
    expect(actions).toMatch(/\["supplier", "payee", "vendor_contact"\]\.includes\(v\)\) return "vendor"/);
  });
});
