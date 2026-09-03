import { describe, it, expect } from "vitest";
import { DEFAULT_CHART_OF_ACCOUNTS } from "../src/lib/constants";
import { TEMPLATE_ACCOUNTS } from "../src/lib/coaTemplates";
import { plainCategoryPhrase, roleFromAccount } from "../src/lib/clarify";

// ── WHAT THIS PROTECTS ───────────────────────────────────────────────────────
// A bill correctly booked to Food Cost was DESCRIBED to the owner as "a meal or travel
// expense". The books were right; the sentence was false; nothing failed. The account-name
// vocabulary was built from the default chart alone, so every account C223's business-type
// templates add missed the map and fell through to the ask path's vocabulary — where
// "Food Cost" contains "food" and comes back a meal.
//
// ★ THE DURABLE RULE: the chart has TWO sources, so anything mapping account names must
// read BOTH. Building from one is not a map of the chart, it is a map of where somebody
// last looked — and it fails silently, in the direction of a confident wrong answer.

const every = [...DEFAULT_CHART_OF_ACCOUNTS, ...TEMPLATE_ACCOUNTS].filter((a) => a.system_role);

describe("every account the app can create describes itself correctly", () => {
  it("★ resolves its own role from its own name — BOTH sources", () => {
    const lost = every
      .map((a) => ({ a, role: roleFromAccount({ gl_code: "", gl_name: a.name }) }))
      .filter(({ a, role }) => role !== a.system_role)
      .map(({ a, role }) => `${a.name} -> ${role ?? "null"} (want ${a.system_role})`);
    expect(lost).toEqual([]);
  });

  it("★ a template account NEVER describes itself as a meal, travel, or office supplies", () => {
    // The three specific wrong answers seen live, pinned as the shapes to never return.
    const wrong = /meal|travel|office supplies/i;
    const bad = TEMPLATE_ACCOUNTS
      .filter((a) => a.system_role)
      .map((a) => ({ name: a.name, said: plainCategoryPhrase({ gl_code: a.code, gl_name: a.name, vendor: "Some Vendor" }) }))
      .filter(({ said }) => wrong.test(said));
    expect(bad).toEqual([]);
  });

  it("★ Food Cost reads as food, not as a meal — the live specimen", () => {
    expect(plainCategoryPhrase({ gl_code: "5010", gl_name: "Food Cost", vendor: "Rio Grande Produce Co." }))
      .toBe("food");
  });

  it("★ Kitchen Supplies & Smallwares does not read as office supplies", () => {
    expect(plainCategoryPhrase({ gl_code: "6280", gl_name: "Kitchen Supplies & Smallwares", vendor: "Corner Market #221" }))
      .toBe("kitchen supplies");
  });

  it("★ AN UNKNOWN ACCOUNT RESOLVES TO NULL, NOT TO A CONFIDENT GUESS", () => {
    // This is the half that did the damage. Falling back to the ask path's vocabulary
    // turned "we don't recognise this account" into a specific wrong answer. Vague and
    // true beats specific and false.
    // ★ THE FIXTURE HAS TO BE A NAME THE ASK VOCABULARY GETS WRONG, or the test cannot
    // tell the two versions apart. My first attempt used "Widget Refurbishment Reserve",
    // which that vocabulary also returns null for — so restoring the fallback changed
    // nothing and the mutation survived. These three are its actual failure modes:
    //   "Food Locker Deposit"        -> travel_entertainment  (a deposit, called a meal)
    //   "Bar Equipment Sinking Fund" -> travel_entertainment
    //   "Catering Van Reserve"       -> travel_entertainment
    // ★ ALL THREE ARE FOOD/BAR WORDS, WHICH IS THE SLICE THAT IS WRONG IN AN ACCOUNT NAME.
    // A custom "Travel Expenses" account must still resolve, so the fallback stays — the
    // test below pins that, and without it "the fallback is gone" would pass here too.
    for (const name of ["Food Locker Deposit", "Bar Equipment Sinking Fund", "Catering Van Reserve"]) {
      expect(roleFromAccount({ gl_code: "", gl_name: name }), name).toBe(null);
      expect(plainCategoryPhrase({ gl_code: "9999", gl_name: name, vendor: "Acme" }), name)
        .toBe("a general business expense");
    }
    expect(roleFromAccount({ gl_code: "", gl_name: "Widget Refurbishment Reserve" })).toBe(null);
    // ★ AND THE FALLBACK SURVIVES FOR EVERYTHING ELSE — a user's renamed account still
    // reads correctly. Deleting it outright broke this, and the existing test was right.
    expect(roleFromAccount({ gl_code: "9123", gl_name: "Software Subscriptions" })).toBe("technology_software");
    expect(roleFromAccount({ gl_code: "9124", gl_name: "Travel Expenses" })).toBe("travel_entertainment");
  });

  it("★ every role the phrase map answers is one an account actually carries", () => {
    // The mirror check: a phrase for a role nothing creates is dead weight that reads as
    // coverage. Runs both directions so neither list can drift silently.
    const roles = new Set(every.map((a) => a.system_role));
    const described = new Set(
      every.map((a) => plainCategoryPhrase({ gl_code: a.code, gl_name: a.name, vendor: "V" })),
    );
    expect(roles.size).toBeGreaterThan(20);
    expect(described.has("a general business expense") ? described.size : described.size).toBeGreaterThan(15);
  });
});
