import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  inboundAddress, inboundTokenOf, senderAllowed, bumpInboundCounters, planInboundMessage,
  receiptCopy, unknownSenderCopy, replyTokenIn, replyTokenTag, replyBodyOf, INBOUND_STATUS,
  INBOUND_LIMITS, MAX_ATTACHMENT_BYTES,
} from "../supabase/functions/_shared/mailChannel.js";
import { containsOwnerJargon } from "../src/lib/clarify.js";

// ═════════════════════════════════════════════════════════════════════════════
// O82 — EMAIL FIRST. The decisions the receiver makes, tested where the receiver cannot be
// (it runs in Deno with the service role). docs/EMAIL_CHANNEL_SPEC_O82.md §2, §4.2, §7.
// ═════════════════════════════════════════════════════════════════════════════

const NOW = "2026-09-14T15:00:00Z";
const members = ["Alex@Example.com"];
const pdf = (name = "hcm-0805.pdf", size = 40_000) => ({ filename: name, contentType: "application/pdf", size });

describe("the address", () => {
  it("is docs-<token>@in.<domain>, and the token comes back out of it", () => {
    const addr = inboundAddress("k7f2m9q1zx", "shadowcfo.com");
    expect(addr).toBe("docs-k7f2m9q1zx@in.shadowcfo.com");
    expect(inboundTokenOf("Red River <DOCS-K7F2M9Q1ZX@in.shadowcfo.com>")).toBe("k7f2m9q1zx");
  });
  it("refuses a guessable token — the address IS the secret half of the wall", () => {
    expect(inboundAddress("redriver", "shadowcfo.com")).toBe(null);
    expect(inboundTokenOf("docs-redriver@in.shadowcfo.com")).toBe(null);
  });
});

describe("★★ the sender wall (§2.2)", () => {
  it("a member may send; case and display-name noise do not matter", () => {
    expect(senderAllowed({ from: "alex@example.com", memberEmails: members })).toBe(true);
    expect(senderAllowed({ from: "Alex A <ALEX@example.com>", memberEmails: members })).toBe(true);
  });
  it("an allowed non-member may send", () => {
    expect(senderAllowed({ from: "asst@cpa.com", memberEmails: members, allowedSenders: ["asst@cpa.com"] })).toBe(true);
  });
  it("★ anyone else may not — and an empty From: is never allowed", () => {
    expect(senderAllowed({ from: "stranger@evil.com", memberEmails: members })).toBe(false);
    expect(senderAllowed({ from: "", memberEmails: members, allowedSenders: [""] })).toBe(false);
  });
  it("★★ a refused sender produces NO intake and is not charged against the counters", () => {
    const counters = { inbound_hour_count: 3, inbound_hour_at: NOW, inbound_day_count: 3, inbound_day_at: NOW };
    const plan = planInboundMessage({ from: "stranger@evil.com", to: "docs-k7f2m9q1zx@in.x", attachments: [pdf()], memberEmails: members, counters, now: NOW });
    expect(plan.status).toBe(INBOUND_STATUS.UNKNOWN_SENDER);
    expect(plan.intake).toEqual([]);
    expect(plan.counters.inbound_hour_count).toBe(3);
  });
});

describe("★ per-company counters (§2.6) — read, decide, charge only when allowed", () => {
  it("charges an accepted message and refuses at the wall without charging", () => {
    let c = {};
    for (let i = 0; i < INBOUND_LIMITS.perHour; i++) { const r = bumpInboundCounters(c, NOW); expect(r.allowed).toBe(true); c = r.counters; }
    const r = bumpInboundCounters(c, NOW);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("hour");
    expect(r.counters.inbound_hour_count).toBe(INBOUND_LIMITS.perHour);   // not 51
  });
  it("the hour window resets; the day window is the brake behind it", () => {
    const c = { inbound_hour_count: 50, inbound_hour_at: "2026-09-14T13:00:00Z", inbound_day_count: 199, inbound_day_at: "2026-09-14T00:30:00Z" };
    const r = bumpInboundCounters(c, NOW);
    expect(r.allowed).toBe(true);
    expect(r.counters.inbound_hour_count).toBe(1);
    expect(r.counters.inbound_day_count).toBe(200);
    expect(bumpInboundCounters(r.counters, NOW).reason).toBe("day");
  });
});

describe("★★ what a message becomes (§2.3)", () => {
  const base = { from: "alex@example.com", to: "docs-k7f2m9q1zx@in.x", memberEmails: members, now: NOW };

  it("one intake per readable attachment; an unreadable one is KEPT and not processed", () => {
    const plan = planInboundMessage({ ...base, attachments: [pdf(), { filename: "notes.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 100 }, { filename: "big.pdf", contentType: "application/pdf", size: MAX_ATTACHMENT_BYTES + 1 }] });
    expect(plan.status).toBe(INBOUND_STATUS.ACCEPTED);
    expect(plan.intake.map(i => [i.process, i.reason])).toEqual([[true, null], [false, "unreadable_type"], [false, "too_large"]]);
  });
  it("a content type with parameters is still read (\"application/pdf; name=x\")", () => {
    const plan = planInboundMessage({ ...base, attachments: [{ filename: "a.pdf", contentType: "Application/PDF; name=a.pdf", size: 10 }] });
    expect(plan.intake[0].process).toBe(true);
  });
  it("no attachment is not a document — it is a sentence for the assistant", () => {
    expect(planInboundMessage({ ...base, attachments: [] }).status).toBe(INBOUND_STATUS.NO_ATTACHMENTS);
  });
  it("★ a reply to something we sent is a REPLY even when it carries an attachment", () => {
    const plan = planInboundMessage({ ...base, subject: `Re: What was this? ${replyTokenTag("abcdefghijklmnop")}`, attachments: [pdf()] });
    expect(plan.status).toBe(INBOUND_STATUS.REPLY);
    expect(plan.replyToken).toBe("abcdefghijklmnop");
    expect(plan.intake).toEqual([]);
  });
  it("the rate wall comes AFTER the sender wall, so a stranger cannot spend the company's allowance", () => {
    const counters = { inbound_hour_count: 50, inbound_hour_at: NOW, inbound_day_count: 50, inbound_day_at: NOW };
    expect(planInboundMessage({ ...base, from: "stranger@evil.com", attachments: [pdf()], counters }).status).toBe(INBOUND_STATUS.UNKNOWN_SENDER);
    expect(planInboundMessage({ ...base, attachments: [pdf()], counters }).status).toBe(INBOUND_STATUS.RATE_LIMITED);
  });
});

describe("reply tokens survive the mail client", () => {
  it("is found in a forwarded / re: subject, case-insensitively", () => {
    expect(replyTokenIn("RE: Fwd: what was this [sc-ABCDEFGHIJKLMNOP] ?")).toBe("abcdefghijklmnop");
    expect(replyTokenIn("no token here")).toBe(null);
  });
  it("the reply body stops at the quoted original", () => {
    expect(replyBodyOf("It was the linen service.\n\nOn Mon, Sep 14, Shadow wrote:\n> What was this $145?")).toBe("It was the linen service.");
    expect(replyBodyOf("just this")).toBe("just this");
  });
});

describe("★★ copy is derived from the plan and says SAVED, never BOOKED (§4.2)", () => {
  it("counts what was created", () => {
    expect(receiptCopy({ saved: 3 }).body).toMatch(/^Got it — 3 documents saved\./);
    expect(receiptCopy({ saved: 1, kept: 2 }).body).toMatch(/1 document saved.*We kept 2 files we can't read/);
    expect(receiptCopy({ saved: 0, kept: 1 }).subject).toMatch(/couldn't read/);
    expect(receiptCopy({}).subject).toBe("We didn't find anything to save");
  });
  it("★ never claims a booking — at send time, saved is what is true", () => {
    for (const c of [receiptCopy({ saved: 3 }), receiptCopy({ saved: 1, kept: 1 }), receiptCopy({})]) {
      expect(c.body.toLowerCase()).not.toMatch(/\bbooked\b|\brecorded\b|\bin your books\b/);
    }
  });
  it("★ passes the owner-jargon guard, every kind", () => {
    const bodies = [receiptCopy({ saved: 3 }).body, receiptCopy({ saved: 1, kept: 2 }).body, receiptCopy({}).body,
      unknownSenderCopy({ from: "x@y.com", subject: "Invoice 42" })];
    for (const b of bodies) expect(containsOwnerJargon(b), b).toBe(false);
  });
});

describe("★ one implementation, two importers", () => {
  it("the module is under supabase/functions/_shared and does no I/O", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "supabase/functions/_shared/mailChannel.js"), "utf8");
    expect(src).not.toMatch(/\bfetch\(|Deno\.|createClient|supabase\.|Math\.random|Date\.now\(|new Date\(\)/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// The edge functions cannot run here (Deno, service role). What CAN be held is their
// shape: where the decisions come from, what they refuse to do, and the order of writes.
// A source guard is weaker than a run — stated — but it fails when the structure that
// keeps this safe is edited away, which is how the ·3a incidents began.
// ═════════════════════════════════════════════════════════════════════════════
describe("★ receive-mail — I/O around shared decisions, and nothing books", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "supabase/functions/receive-mail/index.ts"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");
  it("imports every decision from _shared and defines no rule of its own", () => {
    expect(code).toMatch(/from "\.\.\/_shared\/mailChannel\.js"/);
    for (const fn of ["planInboundMessage", "receiptCopy", "inboundTokenOf"]) expect(code).toContain(`${fn}(`);
    expect(code).not.toMatch(/READABLE_TYPES|allowed_senders\.includes|memberEmails\.includes/);
  });
  it("★★ refuses an unsigned request BEFORE parsing the body", () => {
    const sig = code.indexOf("verifySvix(req, raw)"), parse = code.indexOf("JSON.parse(raw)");
    expect(sig).toBeGreaterThan(0);
    expect(parse).toBeGreaterThan(sig);
    expect(code.slice(sig, parse)).toMatch(/return ok\(\{ error: "bad signature" \}, 401\)/);
  });
  it("★★ never books, never calls the AI, never touches the ledger", () => {
    expect(code).not.toMatch(/post_journal_entry|journal_entries|ai-proxy|api\.anthropic|classify|extract/i);
  });
  it("★ stores bytes BEFORE the intake row, and stamps source = email", () => {
    const up = code.indexOf('admin.storage.from("documents").upload(path'), row = code.indexOf('from("document_intake").insert(');
    expect(up).toBeGreaterThan(0);
    expect(row).toBeGreaterThan(up);
    expect(code.slice(row, row + 400)).toMatch(/source: "email"/);
  });
  it("★ the raw message is stored for a REFUSED sender too (it is what a person allows from)", () => {
    const raw = code.indexOf("const rawPath ="), accepted = code.indexOf("plan.status === INBOUND_STATUS.ACCEPTED");
    expect(raw).toBeGreaterThan(0);
    expect(raw).toBeLessThan(accepted);
  });
  it("the receipt reads the counts this run CREATED, not the payload", () => {
    expect(code).toMatch(/receiptCopy\(\{ saved, kept/);
    expect(code).not.toMatch(/receiptCopy\(\{[^}]*attachment_count/);
  });
  it("an unknown token is answered 200 and nothing else — no probe learns which tokens exist", () => {
    expect(code).toMatch(/if \(!token\) return ok\(\{ ignored: "no token" \}\)/);
    expect(code).toMatch(/if \(!channel\) return ok\(\{ ignored: "unknown token" \}\)/);
  });
});

describe("★ send-mail — a row before the provider, and no relay", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "supabase/functions/send-mail/index.ts"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");
  it("★★ inserts the outbound row BEFORE calling the provider", () => {
    const row = code.indexOf('from("outbound_messages").insert('), send = code.indexOf('fetch("https://api.resend.com/emails"');
    expect(row).toBeGreaterThan(0);
    expect(send).toBeGreaterThan(row);
  });
  it("★★ a provider refusal marks the row failed and reports NOT sent", () => {
    expect(code).toMatch(/status: "failed"[\s\S]{0,300}it was not sent/);
  });
  it("★ questions and reports go only to a member; an invoice only about this company's invoice", () => {
    expect(code).toMatch(/MEMBER_ONLY_KINDS = new Set\(\["question", "report", "digest"\]\)/);
    expect(code).toMatch(/inv\.company_id !== companyId/);
  });
  it("a question carries its reply token in the subject", () => {
    expect(code).toMatch(/kind === "question" \? `\$\{subject\} \$\{replyTokenTag\(token\)\}`/);
  });
});
