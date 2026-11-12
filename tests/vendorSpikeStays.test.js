import { describe, it, expect } from "vitest";
import { runAnomalyDetection } from "../src/lib/insights";

// C616 — review finding R5: a HIGH vendor-spike alert cleared itself when the vendor's next
// ordinary charge was booked.
const now = new Date("2026-08-28T12:00:00");
const row = (id, amount, date) => ({ id, vendor: "Lone Star Supply", amount, date, gl_code: "5000", type: "expense", status: "booked" });
const spikes = (ledger) => runAnomalyDetection(ledger, [], now).filter((a) => a.type === "vendor_spike");
const usual = [row("a", 400, "2026-06-05"), row("b", 410, "2026-07-03"), row("c", 395, "2026-07-31")];

describe("a spike stays raised while it is recent", () => {
  it("the spike is raised when it is the latest charge", () => {
    const s = spikes([...usual, row("big", 4000, "2026-08-10")]);
    expect(s.map((x) => x.invoice_ids)).toEqual([["big"]]);
  });

  it("★ and STILL raised — with the same id — after an ordinary charge is booked after it", () => {
    const before = spikes([...usual, row("big", 4000, "2026-08-10")]);
    const after = spikes([...usual, row("big", 4000, "2026-08-10"), row("next", 402, "2026-08-24")]);
    expect(after.map((x) => x.id)).toEqual(before.map((x) => x.id));   // the same fingerprint → not auto-resolved
  });

  it("ordinary charges are not spikes because a big one is in the mix", () => {
    const s = spikes([...usual, row("big", 4000, "2026-08-10"), row("next", 402, "2026-08-24")]);
    expect(s.flatMap((x) => x.invoice_ids)).toEqual(["big"]);
  });

  it("a charge older than 40 days is not raised as news", () => {
    expect(spikes([...usual, row("big", 4000, "2026-07-10"), row("next", 402, "2026-08-24")])).toEqual([]);
  });
});
