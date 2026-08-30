import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  validateComment, commentsFor, evidencePrompt, dismissalSummary,
  MAX_COMMENT_CHARS, EVIDENCE_SUGGESTED_ABOVE,
} from "../src/lib/anomalyNotes";

// ═════════════════════════════════════════════════════════════════════════════
// THE LAST TWO OF THE REVIEW-CARD TRIO. Both exist because dismissing an anomaly is a
// JUDGEMENT, and the screen made it alone and recorded it as a bare sentence.
// ═════════════════════════════════════════════════════════════════════════════

describe("a comment is not a clear action", () => {
  it("rejects an empty note, and says what to do rather than what went wrong", () => {
    expect(validateComment("   ").ok).toBe(false);
    expect(validateComment("   ").error).toMatch(/Write something/);
  });

  it("★ a note longer than the column allows is refused HERE, not by the database", () => {
    // The column caps at 2000. A refusal from Postgres reaches the user as a constraint
    // name; this one reaches them as a sentence.
    const r = validateComment("x".repeat(MAX_COMMENT_CHARS + 1));
    expect(r.ok).toBe(false);
    expect(r.error).toContain(String(MAX_COMMENT_CHARS));
  });

  it("trims, and keeps the trimmed text (what is stored is what was validated)", () => {
    expect(validateComment("  it was a deposit and a bill  ")).toEqual({ ok: true, text: "it was a deposit and a bill", error: null });
  });

  it("a thread reads oldest-first, and an undated note is kept rather than dropped", () => {
    const rows = [
      { id: 2, anomaly_id: "a", body: "second", created_at: "2026-08-02" },
      { id: 9, anomaly_id: "b", body: "other card", created_at: "2026-08-01" },
      { id: 1, anomaly_id: "a", body: "first", created_at: "2026-08-01" },
      { id: 3, anomaly_id: "a", body: "no timestamp" },
    ];
    expect(commentsFor(rows, "a").map((c) => c.body)).toEqual(["first", "second", "no timestamp"]);
  });
});

describe("★★ evidence is suggested, never required — and the prompt reads AMOUNTS", () => {
  it("suggests above the threshold and stays quiet below it", () => {
    expect(evidencePrompt({ amounts: [EVIDENCE_SUGGESTED_ABOVE + 1] }).suggest).toBe(true);
    expect(evidencePrompt({ amounts: [EVIDENCE_SUGGESTED_ABOVE] }).suggest).toBe(false);
    expect(evidencePrompt({ amounts: [12.5] }).suggest).toBe(false);
    expect(evidencePrompt({ amounts: [] }).suggest).toBe(false);
  });

  it("★ reads the LARGEST linked amount, and sign does not matter", () => {
    // A credit of -4,000 is as material as a debit of 4,000; a prompt that missed one
    // would be silent on exactly half the ledger.
    expect(evidencePrompt({ amounts: [10, -4000, 25] })).toMatchObject({ suggest: true, largest: 4000 });
  });

  it("★★ it is a PROMPT, not a gate — nothing here can refuse a dismissal", () => {
    // The whole point: a hard requirement produces attachments chosen for being nearest,
    // which is worse than none because it LOOKS like support. `evidencePrompt` returns a
    // suggestion and a sentence and has no way to express a refusal.
    const r = evidencePrompt({ amounts: [999999] });
    expect(Object.keys(r).sort()).toEqual(["largest", "sentence", "suggest"]);
    expect(r.sentence).toMatch(/optional/i);
    expect(r.sentence).not.toMatch(/must|required|cannot|need to/i);
  });

  it("stops suggesting once something is attached", () => {
    expect(evidencePrompt({ amounts: [50000], attachedCount: 1 }).suggest).toBe(false);
  });

  it("★ the source file cannot reach the anomaly's WORDS — only its amounts", () => {
    // §9: a sentence about what the system did is derived from the record. A prompt keyed
    // on the title would fire on a $12 charge whose title said "large" and stay silent on
    // a $40,000 one whose title did not.
    const src = fs.readFileSync(path.join(process.cwd(), "src/lib/anomalyNotes.js"), "utf8")
      .split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    const fn = src.slice(src.indexOf("export function evidencePrompt"), src.indexOf("export function dismissalSummary"));
    expect(fn).not.toMatch(/\.title|\.detail|\.type|\.severity/);
  });
});

describe("★ the history sentence is built from the STORED row", () => {
  it("names the reason and counts what is actually linked", () => {
    const a = { dismissed_reason: "covered by the lease", evidence_doc_ids: ["d1", "d2"] };
    expect(dismissalSummary(a, [{ id: "d1" }, { id: "d2" }])).toBe("covered by the lease · 2 documents attached");
  });

  it("★★ an attachment that no longer resolves is REPORTED, not quietly uncounted", () => {
    // O87(v) was exactly this shape: silence made three cards unplaceable. A summary that
    // says "1 document attached" over two references is a claim about a query.
    const a = { dismissed_reason: "duplicate of the March bill", evidence_doc_ids: ["d1", "gone"] };
    const out = dismissalSummary(a, [{ id: "d1" }]);
    expect(out).toContain("1 document attached");
    expect(out).toContain("1 attached document can no longer be found");
  });

  it("no reason ⇒ no sentence (a dismissal without one should not exist)", () => {
    expect(dismissalSummary({ evidence_doc_ids: ["d1"] }, [{ id: "d1" }])).toBe(null);
  });

  it("says nothing about evidence when there is none — no empty clause", () => {
    expect(dismissalSummary({ dismissed_reason: "spoke to the vendor" }, [])).toBe("spoke to the vendor");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ★★ THE SEPARATION OF DUTIES, PINNED IN BOTH LAYERS.
// Dismissing clears a flag AND feeds `priorDismissalFor`, which downgrades later flags for
// the same vendor and amount — so a non-reviewer who could dismiss could lower the guard
// against a repeat of the thing they cleared. `056` enforced that in the UI only, and said
// so in its own header. `080` puts it in the database.
// ═════════════════════════════════════════════════════════════════════════════
describe("★★ who may comment vs who may dismiss", () => {
  const view = fs.readFileSync(path.join(process.cwd(), "src/components/views/ReviewView.jsx"), "utf8");
  const mig = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/080_anomaly_notes_and_evidence.sql"), "utf8");

  it("★ the comment control is NOT gated on isReviewer", () => {
    const thread = view.slice(view.indexOf("const thread = commentsFor("), view.indexOf("{isReviewer && dismissFor === a.id"));
    expect(thread).toMatch(/Add a note/);
    expect(thread).not.toMatch(/isReviewer/);
  });

  it("the note box says what it does NOT do", () => {
    expect(view).toMatch(/This adds context\. It doesn't clear the flag\./);
  });

  it("★★ the database requires a reviewer AND a reason for a dismissal", () => {
    const policy = mig.slice(mig.indexOf("create policy anomalies_update"));
    expect(policy).toMatch(/status is distinct from 'dismissed'/);
    expect(policy).toMatch(/is_company_reviewer\(company_id\)/);
    expect(policy).toMatch(/length\(btrim\(dismissed_reason\)\) > 0/);
  });

  it("★★ and it discriminates by the RESULTING ROW, so housekeeping still works", () => {
    // The 079 lesson applied deliberately rather than after breaking something: anomalies
    // are also updated by auto-resolve, sign-off expiry, reopen and last_seen bumps, and
    // all of those run as whoever is logged in — including an OWNER, who is not a reviewer.
    // A blanket requirement would have switched off anomaly housekeeping for every
    // owner-run company.
    const policy = mig.slice(mig.indexOf("create policy anomalies_update"), mig.indexOf("commit;", mig.indexOf("create policy anomalies_update")));
    expect(policy).toMatch(/using \(public\.is_company_member\(company_id\)\)/);
    // the reviewer test lives INSIDE the dismissed branch, not at the top of `with check`
    expect(policy.indexOf("status is distinct from 'dismissed'")).toBeLessThan(policy.indexOf("is_company_reviewer"));
  });

  it("★ comments are append-only — no update or delete policy is granted", () => {
    // ★ END ANCHOR SEARCHED FROM THE START OFFSET. `-- ── (3)` also appears in the file's
    // HEADER comment, so a bare indexOf returned a position BEFORE the start and the slice
    // came back empty — the assertion then failed against a correct migration. Same
    // mistake as C237 this morning, twice in one day, and the quiet version of it is a
    // slice that happens to be non-empty and contains none of what is asserted.
    const cStart = mig.indexOf("create table if not exists public.anomaly_comments");
    const block = mig.slice(cStart, mig.indexOf("the reviewer gate, now in the database", cStart));
    expect(block).toMatch(/for select to authenticated/);
    expect(block).toMatch(/for insert to authenticated/);
    expect(block).not.toMatch(/for update|for delete|for all/);
    // and a comment cannot be posted in someone else's name
    expect(block).toMatch(/author_id = auth\.uid\(\)/);
  });
});
