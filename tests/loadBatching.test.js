import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

// ─────────────────────────────────────────────────────────────────────────────
// O107 cause 1 — loading a company was eleven network round trips in series.
//
// None of the reads needs another's result, so the wall-clock cost was the SUM of eleven
// latencies where it can be the MAXIMUM: roughly 1-3 seconds of pure waiting on every load
// and every company switch, none of it computation.
//
// ★★ AND THE SERIAL VERSION HAD A ROBUSTNESS BUG, NOT ONLY A SPEED ONE: a single failing
// table STARVED EVERY TABLE AFTER IT. A documents error meant reconciliations, contracts and
// the audit log never loaded — silently, under a comment claiming it "degrades gracefully".
// ─────────────────────────────────────────────────────────────────────────────

const app = readFileSync("src/App.jsx", "utf8");
const start = app.indexOf("const loadAllData");
const body = (() => {
  let d = 0, j = app.indexOf("{", app.indexOf("=>", start));
  for (let k = j; k < app.length; k++) {
    if (app[k] === "{") d++;
    else if (app[k] === "}" && --d === 0) return app.slice(start, k);
  }
  return "";
})();
// Comments name tables too — six guards in this repo have tripped on their own prose.
const code = body.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

describe("loading a company does not serialise its independent reads", () => {
  it("the slice is real", () => {
    expect(start).toBeGreaterThan(-1);
    expect(code.length).toBeGreaterThan(2000);
    expect(code).toContain('.from("contacts")');
  });

  it("★ the reads are batched, not awaited one at a time", () => {
    // Every table read now lives inside a batch, so the awaits left are the batches plus
    // the critical ledger fetch. A regression to sequential awaits shows up here first.
    const awaits = (code.match(/await /g) || []).length;
    expect(awaits).toBeLessThanOrEqual(5);
    expect((code.match(/Promise\.allSettled/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it("★★ allSettled, NOT all — one failing table must not starve the rest", () => {
    // Promise.all discards every sibling result on the first rejection, which would keep
    // exactly the flaw this change exists to remove.
    expect(code).not.toMatch(/Promise\.all\(/);
  });

  it("★ a rejected read degrades to the same 'no data' branch it always took", () => {
    expect(code).toMatch(/status === "fulfilled" \? \(r\.value \|\| \{\}\) : \{\}/);
  });

  it("★★ and a company switched mid-flight is not marked loaded — false emptiness is the one thing this function refuses", () => {
    // The batch guard returns from inside the try, which still runs the finally.
    expect(code).toMatch(/finally \{ if \(currentCompany\.id === cid\) setCompanyDataLoaded\(true\); \}/);
    // …and the guard itself exists after the batch resolves.
    const batchAt = code.indexOf("Promise.allSettled");
    expect(code.indexOf("if (currentCompany.id !== cid) return;", batchAt)).toBeGreaterThan(batchAt);
  });
});
