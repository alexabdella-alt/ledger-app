import { describe, it, expect } from "vitest";
import { flattenJournalEntries } from "../src/lib/ledger.js";
import { classifyTxn } from "../src/lib/txnPresent.js";
import { ownerAccountName } from "../src/lib/categoryLabel.js";

// C658 — how C655's entries list on the Money page, through the real flatten.
const ACC = [["1000","Cash"],["1010","Savings"],["2200","Credit Card Liability"],["2600","Notes Payable"],["3300","Owner's Draw / Distributions"],["3400","Opening Balance Equity"],["3500","Owner Contributions"],["8000","Interest Expense"]].map(([code,name])=>({code,name}));
const acct = (c) => ({ code: c, name: ACC.find(a=>a.code===c).name });
const je = (id, lines, extra = {}) => ({ id, entry_date: "2026-03-15", description: id, status: "posted", deleted_at: null, source: "bank_import", payment_status: "paid", created_at: "2026-03-15T10:00:00Z",
  journal_entry_lines: lines.map((l,n)=>({ id:`${id}-${n}`, debit:l[1], credit:l[2], accounts: acct(l[0]) })), ...extra });
const shown = (e) => { const [r] = flattenJournalEntries([e], ACC); const c = classifyTxn(r, { apCode: "2000", arCode: "1100" }); return [ownerAccountName(c.account.name), c.inflow]; };

describe("★ each entry lists as what it was, with the right direction", () => {
  it("money the owner put in", () => expect(shown(je("c", [["1000",2000,0],["3500",0,2000]]))).toEqual(["Money you've put in", true]));
  it("loan money received", () => expect(shown(je("l", [["1000",10000,0],["2600",0,10000]]))).toEqual(["Loans you owe", true]));
  it("money taken out by the owner", () => expect(shown(je("d", [["3300",500,0],["1000",0,500]]))).toEqual(["Money you've taken out", false]));
  it("a card payment", () => expect(shown(je("k", [["2200",1240,0],["1000",0,1240]]))).toEqual(["Owed on credit cards", false]));
  it("the opening position still lists as Cash (C541)", () => {
    expect(shown(je("o", [["1000",10000,0],["3400",0,10000]], { source: "opening_balance" }))).toEqual(["Cash", true]);
  });
});
