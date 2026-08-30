import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { DEFAULT_CHART_OF_ACCOUNTS } from "../src/lib/constants.js";

// ═════════════════════════════════════════════════════════════════════════════
// ★★★ O109 — THE ASSISTANT MAY RECOGNISE AN ACCOUNT, NEVER INVENT ONE.
//
// `resolveAccountId` is reached from the AI action path (`add_rule`,
// `set_contact_rule`, `add_recurring`), so a number the model made up could mint a
// PERMANENT account on a client's chart of accounts. The client asked a question in chat;
// they did not ask for their chart to be reorganised.
//
// ★★ THE SPLIT IS BETWEEN RECOGNISING AND INVENTING, and "always refuse" would have been
// wrong: a code in the canonical chart that this company simply predates is a recognisable
// account — exactly what the O35 audit found for merchant fees on eight of eleven companies.
// Refusing it would break "make a rule for Marketing" on a company lacking 6300: real work,
// refused for a bookkeeping reason the person cannot see.
// ═════════════════════════════════════════════════════════════════════════════

const app = fs.readFileSync(path.join(process.cwd(), "src/App.jsx"), "utf8");
const fn = app.slice(app.indexOf("const resolveAccountId = async"), app.indexOf("const persistChatRule"));
const code = fn.split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n");

describe("★★★ a code from nowhere is refused", () => {
  it("★★★ the refusal happens BEFORE any insert", () => {
    // If the check sat after, the account would already exist by the time we declined.
    const guard = code.indexOf("if (!def) {");
    const insert = code.indexOf('.from("accounts")\n        .insert(');
    expect(guard).toBeGreaterThan(-1);
    expect(insert === -1 || guard < insert).toBe(true);
  });

  it("★★ it is audited AND said to the person, not just logged", () => {
    expect(code).toMatch(/ai_account_invention_refused/);
    expect(code).toMatch(/showNotification\(/);
  });

  it("★★ and the message offers the two things they can actually do", () => {
    // "I won't do that" with no way forward is a dead end. Add it yourself, or name one.
    expect(app).toMatch(/I won't add one on my own/);
    expect(app).toMatch(/Add it in Settings first, or tell me which existing account to use/);
  });

  it("★ the refusal returns null so the caller cannot proceed as if it worked", () => {
    // ★ SLICED TO THE BLOCK'S CLOSING BRACE, not to a character count. My first version took
    // 400 characters and the `return null` sits ~450 in, behind two long strings — a test
    // that failed on correct code because the window was arbitrary. A count is a guess about
    // how long code is; the brace is where the block actually ends.
    const start = code.indexOf("if (!def) {");
    const refusal = code.slice(start, code.indexOf("\n      }", start));
    expect(refusal).toMatch(/return null;/);
    // and nothing writes inside it
    expect(refusal).not.toMatch(/\.insert\(/);
  });
});

describe("★★ a recognisable account is still created — and now SAID", () => {
  it("★★★ creating one is announced, because an invisible action will be repeated (§9)", () => {
    // The old path created accounts audibly in the audit log and silently on screen. A
    // person who cannot see that their chart changed has no way to disagree with it.
    expect(app).toMatch(/Added \$\{glCode\} \$\{def\.name\} to your chart of accounts — you didn't have one\./);
  });

  it("★ and it is still audited as a materialisation, with the O108 action name intact", () => {
    // The O108 detector reads this action; renaming it would blind an instrument that took
    // a migration and a live diagnosis to restore.
    expect(code).toMatch(/logAudit\("account_materialized"/);
  });

  it("★ the canonical chart is what 'recognisable' means — not a guess", () => {
    expect(code).toMatch(/const def = CHART_OF_ACCOUNTS\.find\(a => a\.code === glCode\)/);
  });
});

describe("★ the split is real on live data", () => {
  it("★★ a canonical code is recognisable; an invented one is not", () => {
    // The two sides of the branch, on the actual chart rather than a fixture.
    const codes = new Set(DEFAULT_CHART_OF_ACCOUNTS.map((a) => a.code));
    expect(codes.has("6300")).toBe(true);      // Marketing — the O35 case, must still work
    expect(codes.has("6520")).toBe(true);      // merchant fees — missing on 8 of 11 companies
    expect(codes.has("6999")).toBe(false);     // the shape of a model-invented number
    expect(codes.has("1234")).toBe(false);
  });
});
