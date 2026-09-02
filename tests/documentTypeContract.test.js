import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { DOCUMENT_TYPES, documentTypeFor, isDurableDocId, PLACEHOLDER_DOCUMENT_TYPE, stampsOver } from "../src/lib/docLibrary";

// ── THE CLASS THIS GUARDS ────────────────────────────────────────────────────
// `documents.document_type` is NOT NULL under a CHECK allowing exactly seven values. The
// O97 durable-first write passed the literal "pending", so EVERY upload was rejected: the
// storage blob rolled back, no row was written, `document_intake.document_id` stayed null,
// and the durable queue that fix exists to create has been empty since it shipped.
//
// ★ THE MAPPER THAT PREVENTS THIS ALREADY EXISTED AND WAS ALREADY USED ONE BRANCH AWAY.
// `documentTypeFor` exists precisely so the classifier's vocabulary cannot reach the
// column raw. A guard is only as good as its adoption, so this asserts adoption.
const APP = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");

// Comments and strings carry prose that looks like code; strip them before scanning
// (the sixth and seventh time a source guard in this repo tripped on its own explanation).
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

describe("documents.document_type — every writer speaks the column's vocabulary", () => {
  it("every storeDocument call site passes an allowed type, the mapper, or the placeholder", () => {
    const src = code(APP);
    const calls = [...src.matchAll(/storeDocument\(([^;]*?)\)\s*[;,)]/gs)];
    expect(calls.length).toBeGreaterThan(4);          // refuses to pass by matching nothing
    const bad = [];
    for (const m of calls) {
      const args = m[1];
      // 4th positional arg is the type. Split on top-level commas only.
      const parts = []; let depth = 0, cur = "";
      for (const ch of args) {
        if ("([{".includes(ch)) depth++;
        if (")]}".includes(ch)) depth--;
        if (ch === "," && depth === 0) { parts.push(cur); cur = ""; } else cur += ch;
      }
      parts.push(cur);
      const type = (parts[3] || "").trim();
      if (!type) continue;
      const literal = type.match(/^["'](.+)["']$/);
      const ok = (literal && DOCUMENT_TYPES.includes(literal[1]))
        || type.startsWith("documentTypeFor(")
        || type === "PLACEHOLDER_DOCUMENT_TYPE";
      if (!ok) bad.push(type);
    }
    expect(bad).toEqual([]);
  });

  it("every checked PATCH of document_type speaks the column's vocabulary too", () => {
    // The stamp at the classification boundary wrote `document_type: docType` RAW —
    // `classifyFile` can return "qbo", which the column rejects. The SAME defect as the
    // placeholder literal, in the same feature, on the line that repairs it. A guard
    // scoped only to storeDocument call sites would have missed it entirely.
    //
    // ★ SCOPED TO `patch: {` ON PURPOSE, and the exclusion is evidenced rather than
    // assumed: `unknown_documents.document_type_detected` is free text with no CHECK, so
    // its "Unknown Document" literal is correct there and must not be flagged here. Two
    // tables, two vocabularies; only one has a constraint to honour.
    const src = code(APP);
    const patches = [...src.matchAll(/patch:\s*\{\s*document_type:\s*([^},]+)/g)].map(m => m[1].trim());
    expect(patches.length).toBeGreaterThan(1);      // refuses to pass by matching nothing
    const bad = patches.filter(v => {
      const lit = v.match(/^["'](.+)["']$/);
      if (lit) return !DOCUMENT_TYPES.includes(lit[1]);
      return !(v.startsWith("documentTypeFor(") || v === "PLACEHOLDER_DOCUMENT_TYPE" || v === "type");
    });
    expect(bad).toEqual([]);
  });

  it("the placeholder itself is a value the constraint accepts", () => {
    expect(DOCUMENT_TYPES).toContain(PLACEHOLDER_DOCUMENT_TYPE);
  });

  it("the durable-first caller does not claim durability from a truthy return", () => {
    // ★ TWO VIEWS, and the distinction is the one this repo keeps relearning: the section
    // is LOCATED in the raw source (its anchor is a comment, which stripping deletes) and
    // ASSERTED against the stripped source (so prose cannot satisfy a code assertion).
    const i = APP.indexOf("O97 STEP 1");
    expect(i).toBeGreaterThan(-1);
    const region = code(APP.slice(i, i + 2600));
    // The claim and the guard must both be present, and the guard must gate the claim.
    expect(region).toMatch(/durableDocId\s*=\s*isDurableDocId\(/);
    expect(region).toMatch(/if\s*\(durableDocId\)\s*markIntake/);
  });
});

describe("isDurableDocId — a truthy id is not a durable one", () => {
  it("accepts a real uuid", () => {
    expect(isDurableDocId("3a704760-1e4c-4f6a-9b21-0c8d4e5f6a7b")).toBe(true);
  });
  it("REFUSES storeDocument's in-session fallback, which is what caused the false claim", () => {
    const fallback = String(Date.now() + Math.random());   // exactly what storeDocument returns on failure
    expect(isDurableDocId(fallback)).toBe(false);
  });
  it("refuses a number, a null and an empty string", () => {
    for (const v of [1756742891234.5678, null, undefined, ""]) expect(isDurableDocId(v)).toBe(false);
  });
});

describe("stampsOver — the placeholder must not become the answer", () => {
  it("stamps placeholder → specific", () => {
    expect(stampsOver("other", "invoice")).toBe(true);
    expect(stampsOver(null, "bank_statement")).toBe(true);
  });
  it("NEVER downgrades a specific type back to the placeholder", () => {
    expect(stampsOver("invoice", "other")).toBe(false);
  });
  it("issues no write when the placeholder is genuinely the answer ('other' → 'other')", () => {
    // A document we truly cannot classify would otherwise be re-stamped with the value it
    // already holds on every dedup. Pinned separately because the mutation that removes
    // this guard leaves every downgrade assertion green — the line below catches those.
    expect(stampsOver("other", "other")).toBe(false);
    expect(stampsOver(null, "other")).toBe(false);
  });
  it("NEVER overwrites one specific type with another — that is a reclassification, not a stamp", () => {
    expect(stampsOver("invoice", "receipt")).toBe(false);
    expect(stampsOver("bank_statement", "payroll")).toBe(false);
  });
  it("refuses a type the column would reject, so a stamp cannot reintroduce the bug", () => {
    expect(stampsOver("other", "pending")).toBe(false);
    expect(stampsOver("other", "sometthing")).toBe(false);
  });
});

describe("documentTypeFor still maps the classifier's vocabulary rather than widening", () => {
  it("maps aliases and falls back without ever emitting a rejected value", () => {
    for (const v of ["bill", "statement", "payroll register", "expense", "nonsense", "", null, "pending"]) {
      expect(DOCUMENT_TYPES).toContain(documentTypeFor(v));
    }
  });
});
