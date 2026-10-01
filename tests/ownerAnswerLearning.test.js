import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { emptyProfile, learnFromBooking, learnFromCorrection, recallVendor } from "../src/lib/clientProfile";

// ═════════════════════════════════════════════════════════════════════════════
// C558 — ONE ANSWER TEACHES A SUPPLIER (operator delegated the call: "do whatever you think is
// optimal based on industry best").
//
// Before: an answered question card was learned exactly like an unreviewed automatic booking —
// count 1, trusted only from 2 — so answering about Alamo Ice on Aug 6 did not stop the Aug 13
// question (C552). The card even stamped `clarified` on the entry, and nothing read it.
//
// The rule, ranked: a RECODE (the owner picks the category) > an ANSWER (the owner describes
// the bill; the app maps it — §9 says that vouches for what the bill was, not for the mapping)
// > an AUTOMATIC booking. An answer is trusted at once, never overwritten by an automatic
// booking, overridden by a recode — and in the booking path it applies only when the next
// bill's own reading is blank or agrees, never silently replacing a different reading.
// ═════════════════════════════════════════════════════════════════════════════

const ALAMO = "Alamo Ice & Beverage";
const answered = (p, code = "5020", name = "Beverage Cost", date = "2026-08-06") =>
  learnFromBooking(p, { vendor: ALAMO, gl_code: code, gl_name: name, amount: 831.42, date, clarified: true, learned_from_answer: "ice and soda syrup" });
const auto = (p, code = "5020", name = "Beverage Cost", date = "2026-08-13") =>
  learnFromBooking(p, { vendor: ALAMO, gl_code: code, gl_name: name, amount: 858.00, date });

describe("C558 — an answer is trusted at once", () => {
  it("★★★ one answer, and the next bill from that supplier is recognised", () => {
    const p = answered(emptyProfile());
    const hit = recallVendor(p, ALAMO);
    expect(hit).not.toBeNull();
    expect(hit).toMatchObject({ gl_code: "5020", source: "owner_answer", count: 1 });
  });
  it("★★ an automatic booking still has to repeat itself first — unchanged", () => {
    const once = auto(emptyProfile());
    expect(recallVendor(once, ALAMO)).toBeNull();
    expect(recallVendor(auto(once), ALAMO)).toMatchObject({ source: "ai_booking", count: 2 });
  });
});

describe("C558 — and ranked where §9 puts it", () => {
  it("★★★ an automatic booking cannot overwrite what the owner told us", () => {
    const p = auto(answered(emptyProfile()), "6400", "Travel & Entertainment");
    expect(recallVendor(p, ALAMO)).toMatchObject({ gl_code: "5020", source: "owner_answer", count: 2 });
  });
  it("★★ a later answer replaces an earlier one — the owner changed their mind", () => {
    const p = answered(answered(emptyProfile()), "5010", "Food Cost", "2026-08-13");
    expect(recallVendor(p, ALAMO)).toMatchObject({ gl_code: "5010", source: "owner_answer" });
  });
  it("★★★ a RECODE outranks an answer — the owner choosing the category is the stronger fact", () => {
    const p = learnFromCorrection(answered(emptyProfile()), { vendor: ALAMO, gl_code: "5010", gl_name: "Food Cost", date: "2026-08-14" });
    expect(recallVendor(p, ALAMO)).toMatchObject({ gl_code: "5010", source: "human_correction" });
    // …and a later answer does not undo a recode
    expect(recallVendor(answered(p, "6400", "Travel & Entertainment"), ALAMO)).toMatchObject({ gl_code: "5010", source: "human_correction" });
  });
  it("a legacy entry with no source still behaves as an automatic booking", () => {
    const p = { ...emptyProfile(), common_vendors: { [ALAMO.toLowerCase()]: { name: ALAMO, gl_code: "5020", gl_name: "Beverage Cost", count: 1 } } };
    expect(recallVendor(p, ALAMO)).toBeNull();
  });
});

describe("C558 — the booking path", () => {
  const app = fs.readFileSync(path.join(process.cwd(), "src/App.jsx"), "utf8");
  it("★★★ an answer is NOT given a recode's override — it applies only when the reading is blank or agrees", () => {
    expect(app).toMatch(/const isHuman = learned\.source === "human_correction";/);
    expect(app).toMatch(/if \(isHuman \|\| !invoice\.gl_code \|\| String\(invoice\.gl_code\) === String\(learned\.gl_code\)\) \{/);
  });
  it("★★ and the sentence says what actually happened — the owner described it, not categorised it", () => {
    expect(app).toMatch(/You told us what \$\{invoice\.vendor\} was for before, so we booked it the same way\./);
  });
  it("★ the card still stamps the field that is now read", () => {
    const flow = fs.readFileSync(path.join(process.cwd(), "src/components/ClarificationFlow.jsx"), "utf8");
    expect(flow).toMatch(/\.\.\.\(answer \? \{ clarified: true, learned_from_answer: answer \} : \{\}\),/);
  });
});
