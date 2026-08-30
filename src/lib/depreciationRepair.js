// ─────────────────────────────────────────────────────────────────────────────
// O129 — THE REPAIR TOOL THAT HAD NO BUTTON.
//
// `attachDepreciationToExistingAsset` builds a depreciation schedule for equipment already
// in the books. It is real, idempotent and owner/admin-gated — and nothing called it, because
// the control it used to sit behind was removed for good reason: **it asked you to type a
// raw journal-entry id, on the page where you read your financial statements.**
//
// ★★ SO THE ANSWER IS NEITHER "DELETE IT" NOR "PUT THE BOX BACK". The capability is
// legitimate — equipment can reach the books through paths that never created a schedule (a
// QuickBooks import, a hand-entered correction, anything predating the depreciation
// feature) and without one it sits on the balance sheet at full cost forever. What was wrong
// was WHERE it lived: a repair tool with no button is invisible, and a repair tool that asks
// for a database id is unusable. **Put it on the entry that needs repairing**, where the id
// is already known and nobody types anything.
//
// ★ AND IT MUST NOT OFFER ITSELF ON EVERYTHING. Only an entry that actually put money into
// a fixed-asset account can want a schedule — offering it elsewhere would be a control that
// exists to be declined, which is how a screen teaches you to ignore it.
//
// Pure.
// ─────────────────────────────────────────────────────────────────────────────

// Does this entry look like equipment that could carry a depreciation schedule?
// `assetCodes` are the company's fixed-asset account codes, resolved by ROLE upstream —
// never a hardcoded "1500" (§9).
export function isDepreciableEntry(entry = {}, assetCodes = []) {
  if (!entry) return false;
  if (entry.deleted_at || entry.status === "voided" || entry.status === "deleted") return false;
  // Must be a DEBIT to the asset account: a credit is a disposal or a correction, and
  // scheduling depreciation against one would be depreciating a removal.
  if (entry.debit_credit === "credit") return false;
  // ★ NO SEPARATE "did we resolve a fixed-asset account?" GUARD, BECAUSE IT COULD NOT
  // CHANGE THE ANSWER. An empty set matches nothing, so the membership test below already
  // returns false — a mutation removing the guard survived, and investigating showed the
  // CODE was redundant rather than the test weak. A line that reads as a check and cannot
  // affect the outcome is the `if (error)` shape in a different costume.
  const codes = new Set((assetCodes || []).map(String).filter(Boolean));
  if (!codes.has(String(entry.gl_code || ""))) return false;
  return (Number(entry.amount) || 0) > 0;
}

// Already scheduled? `assets` are the company's fixed-asset rows.
export function hasSchedule(entry = {}, assets = []) {
  const je = String(entry.db_entry_id || entry.id || "");
  if (!je) return false;
  return (assets || []).some((a) => a && String(a.source_journal_entry_id) === je);
}

export const DEFAULT_LIFE_YEARS = 5;

// ★ THE SENTENCE READS THE ENTRY, so it cannot describe a schedule for something else (§9).
export function repairOfferCopy(entry = {}) {
  const what = entry.vendor || entry.description || "this purchase";
  return `${what} is recorded as equipment, but it isn't being written down over time. Set that up and we'll spread the cost across its useful life.`;
}

// Validates what a person typed before anything is written.
export function validateRepair({ lifeYears, salvage, inServiceDate, cost } = {}) {
  const years = Number(lifeYears);
  if (!Number.isFinite(years) || years <= 0) return { ok: false, message: "How many years will you use it for?" };
  if (years > 50) return { ok: false, message: "That's longer than we can schedule — 50 years is the maximum." };
  const sal = Number(salvage || 0);
  if (!Number.isFinite(sal) || sal < 0) return { ok: false, message: "Leftover value can't be negative." };
  // ★ SALVAGE ABOVE COST WOULD PRODUCE A NEGATIVE SCHEDULE — depreciation that ADDS value.
  // Caught here rather than by the schedule builder, so the message is about the number the
  // person typed rather than about an internal total.
  if (Number.isFinite(Number(cost)) && Number(cost) > 0 && sal >= Number(cost)) {
    return { ok: false, message: "Leftover value has to be less than what you paid for it." };
  }
  if (inServiceDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(inServiceDate))) {
    return { ok: false, message: "That date doesn't look right." };
  }
  return { ok: true, usefulLifeMonths: Math.round(years * 12), salvageValue: sal, message: null };
}
