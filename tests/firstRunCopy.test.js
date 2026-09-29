import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ═════════════════════════════════════════════════════════════════════════════
// C550 — TWO SENTENCES A BRAND-NEW SIGNUP READS THAT WERE NOT TRUE OF THEIR COMPANY.
//
// Both found in the empty-company first-run sweep (open every screen a new signup can
// reach, with nothing in the books, and read what it says):
//
//   • Taxes — "Your CFAI advisor reviews your books monthly and can provide personalized
//     guidance." **CFAI is the old working name** (one user-visible occurrence in the whole
//     repo) and **the claim is false for anyone who signed up alone**: `O131`/`D2` record
//     that a solo owner has no reviewer at all until they invite an accountant. It sat
//     directly under a tax disclaimer — the worst place in the product to overstate who is
//     watching.
//   • Team — "Invite teammates as admins (full access) or **members** (upload, view, and ask
//     the AI…)". `C225` removed "Member" from the dropdown because the database rejects it
//     and **every invite carrying it was unacceptable**; the heading above that dropdown went
//     on offering the dead role, and never mentioned the **accountant** — the one role this
//     product is built around.
//
// ★★ WHAT IS NOT PINNED HERE, AND WHY: "no visible text on the Team screen may name a role
// the database rejects" is the check this defect argues for, and it is NOT EXPRESSIBLE —
// "MEMBERS (0)" is also the plain English heading of the list of people on the team. So the
// durable check is the agreement one: every capability the heading promises must be a
// capability one of the OPTIONS offers.
// ═════════════════════════════════════════════════════════════════════════════

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
// ★ THE SOURCE QUOTES BOTH OLD SENTENCES TO EXPLAIN WHY THEY WERE WRONG, so a guard that
// matches its own explanation is the C202 false positive — six times over in this repo, and
// duly the seventh on this file's first run. A LINE-PREFIX filter is not enough: a block
// comment's middle lines begin with prose, not with a marker. Strip the BLOCKS.
const codeOnly = (src) =>
  src.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, "").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");

describe("C550 — the Taxes screen does not promise a review nobody is doing", () => {
  const tax = codeOnly(read("src/components/views/TaxView.jsx"));

  it("★★★ the old product name is gone from every user-visible string", () => {
    for (const f of ["src/components/views/TaxView.jsx", "src/components/views/DashboardView.jsx", "src/components/views/ReportsView.jsx"]) {
      expect(codeOnly(read(f)), `${f} still shows "CFAI"`).not.toMatch(/CFAI/);
    }
  });

  it("★★★ and the monthly-review claim is gone, not reworded", () => {
    expect(tax).not.toMatch(/reviews your books monthly/);
  });

  it("★★ the sentence is keyed on `hasAttester`, the signal that knows the answer", () => {
    expect(tax).toMatch(/hasAttester/);
    // O131 — hasAttester DEFAULTS TRUE so a failed membership read cannot manufacture
    // "you have no accountant". The claim may therefore only be made on an explicit false.
    expect(tax).toMatch(/hasAttester === false/);
  });

  it("★★ a company with nobody to review is told so, and told where to fix it", () => {
    const m = tax.match(/hasAttester === false\s*\n?\s*\?\s*"([^"]+)"/);
    expect(m, "the no-attester branch is not a literal sentence any more").toBeTruthy();
    expect(m[1]).toMatch(/Nobody is reviewing your books yet/);
    expect(m[1]).toMatch(/Settings → Team/);          // the door, not just the news
  });

  it("★ and a company that HAS one is promised only what `hasAttester` establishes — capability, not a cadence", () => {
    const after = tax.slice(tax.indexOf("hasAttester === false"));
    const m = after.match(/:\s*"([^"]*accountant[^"]*)"/);
    expect(m, "the attester branch is not a literal sentence any more").toBeTruthy();
    expect(m[1]).toMatch(/can review/);               // what a member with the role CAN do
    expect(m[1]).not.toMatch(/monthly|every month|each month/);
  });
});

describe("C550 — the Team screen's heading describes the roles it actually offers", () => {
  const team = read("src/components/views/TeamView.jsx");
  const code = codeOnly(team);
  const options = [...code.matchAll(/<option value="([^"]+)">([^<]+)<\/option>/g)].map((m) => ({ role: m[1], label: m[2] }));

  it("the dropdown still offers three roles (the C225 set)", () => {
    expect(options.map((o) => o.role)).toEqual(["viewer", "accountant", "admin"]);
  });

  it("★★★ the dead role is gone from the heading — it is the screen C225 fixed for that reason", () => {
    expect(code).not.toMatch(/as admins \(full access\) or members/);
  });

  it("★★ every capability the heading promises is one an OPTION offers", () => {
    const heading = code.match(/Invite someone to your books[^<]*/);
    expect(heading, "the invite heading moved — re-aim this, do not delete it").toBeTruthy();
    const labels = options.map((o) => o.label.toLowerCase()).join(" | ");
    // The heading lists the three choices in the order the dropdown shows them.
    expect(heading[0]).toMatch(/look without changing anything/);
    expect(heading[0]).toMatch(/review and sign off a month/);
    expect(heading[0]).toMatch(/full access/);
    expect(labels).toMatch(/can't change anything/);
    expect(labels).toMatch(/review and sign off a month/);
    expect(labels).toMatch(/full access/);
  });

  it("★ and the accountant — the role this product is built around — is named at all", () => {
    // The old heading offered admins and 'members' and omitted the only role that can sign
    // off a month, which is the whole reason an owner invites anyone (O131 / D2).
    expect(code).toMatch(/review and sign off a month/);
  });
});
