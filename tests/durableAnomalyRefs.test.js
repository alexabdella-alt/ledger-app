import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { durableRefs, anomalyEvidence } from "../src/lib/anomalies";

// ── THE LIVE SPECIMEN (Red River, CPA Review, 2026-09-03) ────────────────────
// "1 of 1 linked entry can no longer be found — it may have been removed since this was
// flagged", on a rent anomaly whose 6100 Rent & Occupancy entry was sitting in the ledger
// at exactly that amount.
//
// Detection runs on whatever is in memory, and right after a booking session that is an
// IN-SESSION object whose id is Date.now() + Math.random(). Persisting that into
// entity_refs stores a pointer valid for minutes.

const UUID = "3a704760-1e4c-4f6a-9b21-0c8d4e5f6a7b";
const inSession = { id: 1756742891234.5678, db_entry_id: UUID, date: "2026-08-01",
                    vendor: "Franklin Ave Properties LP", amount: 4512.75 };
// What the SAME entry looks like after a reload — flattened from the database.
const reloaded  = { id: UUID, db_entry_id: UUID, date: "2026-08-01",
                    vendor: "Franklin Ave Properties LP", amount: 4512.75 };

describe("a stored reference must survive a reload", () => {
  it("★ an in-session float is stored as the DATABASE id", () => {
    expect(durableRefs([inSession.id], [inSession])).toEqual([UUID]);
  });

  it("★★ and the card then resolves it after a reload — the live bug, end to end", () => {
    const stored = durableRefs([inSession.id], [inSession]);
    const ev = anomalyEvidence({ entity_refs: stored }, [reloaded]);
    expect(ev.missing).toBe(0);
    expect(ev.entries.length).toBe(1);
  });

  it("★ WITHOUT the fix that same card reports the entry as gone", () => {
    // The counter-case, so "it resolves" cannot be satisfied by an unrelated change.
    const ev = anomalyEvidence({ entity_refs: [String(inSession.id)] }, [reloaded]);
    expect(ev.missing).toBe(1);
    expect(ev.entries.length).toBe(0);
  });

  it("★ an id that resolves to NOTHING is kept, never dropped", () => {
    // Dropping would shrink `total`, so a genuinely removed entry would stop being
    // reported — trading a visible wrong count for an invisible one.
    expect(durableRefs(["ghost"], [inSession])).toEqual(["ghost"]);
    expect(anomalyEvidence({ entity_refs: ["ghost"] }, [reloaded]).missing).toBe(1);
  });

  it("★ several lines of ONE entry collapse to one reference", () => {
    const l0 = { id: `${UUID}_0`, db_entry_id: UUID };
    const l1 = { id: `${UUID}_1`, db_entry_id: UUID };
    expect(durableRefs([l0.id, l1.id], [l0, l1])).toEqual([UUID]);
  });

  it("★ an id that is ALREADY durable passes through unchanged", () => {
    expect(durableRefs([UUID], [reloaded])).toEqual([UUID]);
  });

  it("★ and the insert path actually calls it — a pure helper nobody uses is the defect", () => {
    const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
    expect(app).toMatch(/invoice_ids:\s*durableRefs\(d\.invoice_ids,\s*invoicesRef\.current\)/);
  });
});
