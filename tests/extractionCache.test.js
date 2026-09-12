import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  usableExtraction, extractionToStore, cacheHitCopy,
  EXTRACTION_VERSION, CACHEABLE, NEVER_CACHED,
} from "../src/lib/extractionCache";

// ═════════════════════════════════════════════════════════════════════════════
// REUSING WHAT WE ALREADY READ (O113 proposal 3, accepted 2026-08-26).
//
// Identical bytes re-uploaded re-ran the whole pipeline. C193 already hashes every document
// to dedupe the library, so the key exists and costs nothing new — and the August drive
// re-uploaded twice, so this is a path people take.
//
// ★★★ THE WHOLE DESIGN IS IN WHICH ANSWERS MAY BE REUSED, NOT IN THE REUSING.
// ═════════════════════════════════════════════════════════════════════════════

describe("★★★ what may be reused, and what may never be", () => {
  it("★★★ the account a charge belongs to is NEVER cached", () => {
    // It depends on the COMPANY'S CHART, which changes — two migrations added accounts
    // today. Reusing it would book a re-uploaded document to a chart that no longer exists:
    // silently, and looking identical to a correct answer.
    expect(Object.values(CACHEABLE)).toEqual(["classify", "extract"]);
    expect(NEVER_CACHED).toContain("code");
    expect(Object.values(CACHEABLE)).not.toContain("code");
  });

  it("★★ and `extractionToStore` cannot be handed a coding to store", () => {
    // The omission has to be structural, not a convention. A caller passing a coding gets it
    // dropped rather than persisted.
    const stored = extractionToStore({ classify: "invoice", extract: { vendor: "Roma" }, code: "6100" });
    expect(Object.keys(stored).sort()).toEqual(["classify", "extract"]);
  });

  it("nothing to store means nothing stored — not an empty object", () => {
    // An empty entry would later read as "we read this and found nothing".
    expect(extractionToStore({})).toBeNull();
    expect(extractionToStore({ classify: null, extract: null })).toBeNull();
  });
});

describe("★★ a cache entry that cannot answer is a MISS, not a hit", () => {
  it("★★★ an empty extraction does not short-circuit the pipeline", () => {
    // Otherwise a re-upload would report "we read this and found nothing" — the O98 shape,
    // with an AI call's cost saved and the answer thrown away.
    expect(usableExtraction({ extraction: {}, extraction_version: EXTRACTION_VERSION }).reason).toBe("empty");
  });

  it("★★★ a stale VERSION is a miss — a prompt fix must not be invisible on re-uploads", () => {
    // Every stored answer came from a model that no longer exists in this system. Reusing it
    // would make a prompt improvement invisible on exactly the documents most likely to be
    // re-uploaded.
    const doc = { extraction: { classify: "invoice" }, extraction_version: "v0" };
    expect(usableExtraction(doc).reason).toBe("stale_version");
  });

  it("★ each miss says WHICH kind it is, so 'the cache never hits' has somewhere to look", () => {
    expect(usableExtraction({}).reason).toBe("none");
    expect(usableExtraction({ extraction: "nonsense", extraction_version: EXTRACTION_VERSION }).reason).toBe("unreadable");
  });

  it("a usable entry comes back with its content", () => {
    const doc = { extraction: { classify: "invoice", extract: { vendor: "Roma" } }, extraction_version: EXTRACTION_VERSION };
    expect(usableExtraction(doc)).toMatchObject({ ok: true, extraction: doc.extraction });
  });
});

describe("★ the version key is a deliberate declaration, not a derived one", () => {
  it("★★ it is a hand-set constant", () => {
    // A hash of the prompt file would invalidate on a typo fix and keep on a semantic
    // change; only a person can tell those apart. So bumping it is a decision someone makes.
    const src = fs.readFileSync(path.join(process.cwd(), "src/lib/extractionCache.js"), "utf8");
    expect(src).toMatch(/export const EXTRACTION_VERSION = "v\d+"/);
    expect(src).not.toMatch(/EXTRACTION_VERSION = .*(hash|Date|createHash)/);
  });
});

describe("★ a reuse is said out loud", () => {
  it("★★ because the best outcome must not read as nothing happening (O128)", () => {
    // A re-upload that finishes instantly, silently, looks like it did nothing at all.
    expect(cacheHitCopy({ name: "August statement.pdf" })).toContain("August statement.pdf");
    expect(cacheHitCopy({})).toMatch(/reused it instead of reading it again/);
  });
});

describe("★★ the store path cannot write a coding, in the app either", () => {
  const app = fs.readFileSync(path.join(process.cwd(), "src/App.jsx"), "utf8");
  const fn = app.slice(app.indexOf("const storeExtraction = async"), app.indexOf("const resolveAccountId"));

  it("★ it writes only the two byte-derived answers, through a checked write", () => {
    expect(fn).toMatch(/extractionToStore\(\{ classify, extract \}\)/);
    expect(fn).toMatch(/checkedRowUpdate\(\{/);
    expect(fn).toMatch(/extraction_version: EXTRACTION_VERSION/);
  });

  it("★★ and the lookup demands a non-null extraction rather than filtering in JS", () => {
    // A row with no extraction is not a candidate; letting it come back and be discarded
    // client-side would make every miss look like a hit that failed validation.
    const look = app.slice(app.indexOf("const priorExtraction = async"), app.indexOf("const storeExtraction"));
    expect(look).toMatch(/\.not\("extraction", "is", null\)/);
    expect(look).toMatch(/usableExtraction\(data\)/);
  });
});

// ── C329 — THE CACHE IS CALLED NOW. IT WAS NOT. ────────────────────────────────
// `priorExtraction` and `storeExtraction` were defined in App.jsx, pinned by the two
// source guards above — which read their BODIES — and invoked by nothing. So no document
// ever had an extraction stored, and no lookup could ever hit: the feature C263 recorded as
// shipped had the exact shape §11 spends pages on (a mechanism nobody triggers is
// indistinguishable from one with nothing to do). Found while looking for a way to link
// O136's unlinked documents from their own stored reading — there were none.
describe("★★★ C329 — the extraction cache has callers, and they read what the writer wrote", () => {
  const app = fs.readFileSync(path.join(process.cwd(), "src/App.jsx"), "utf8");
  const code = app.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  const start = code.indexOf("const processUploadItem = async");
  const end = code.indexOf("const handleBankFile = async", start) > 0 ? code.indexOf("const handleBankFile = async", start) : code.length;
  const proc = code.slice(start, end);
  // The definitions read `const name = async (…)` — no `name(` — so every `name(` is a call.
  const calls = (name) => (code.match(new RegExp(`\\b${name}\\(`, "g")) || []).length;

  it("is scoped to a non-empty slice", () => { expect(start).toBeGreaterThan(0); expect(proc.length).toBeGreaterThan(1000); });

  it("★★ each cache function has at least one CALL SITE — a defined function is not a wired one", () => {
    expect(calls("priorExtraction")).toBeGreaterThanOrEqual(1);
    expect(calls("storeExtraction")).toBeGreaterThanOrEqual(2);   // invoice branch + non-invoice classify
  });

  it("the lookup runs BEFORE the classify call and its answer replaces it", () => {
    expect(proc).toMatch(/prior = await priorExtraction\(contentHash\);[\s\S]{0,200}if \(cachedType\) \{ docType = cachedType;[\s\S]{0,80}else docType = await classifyFile\(/);
  });

  it("a stored reading skips the extraction fetch; a fresh reading is stored before the empty-check can return", () => {
    const inv = proc.slice(proc.indexOf('if (docType === "invoice") {'));
    expect(inv).toMatch(/if \(cachedExtract\) \{\s*extractedList = cachedExtract;[\s\S]{0,200}\} else \{[\s\S]{0,400}fetch\(AI_PROXY_URL/);
    const stored = inv.indexOf("void storeExtraction(durableDocId, { classify: docType, extract: extractedList })");
    const emptyCheck = inv.indexOf("if (extractedList.length === 0) {");
    expect(stored).toBeGreaterThan(0);
    expect(stored).toBeLessThan(emptyCheck);
  });

  it("★ the caller reads the SAME keys the writer stores — the ·3a seam, crossed", () => {
    // The writer keys on CACHEABLE; the caller spells the keys by hand. If either moved,
    // every lookup would be a silent miss with nothing on screen to say so.
    const stored = extractionToStore({ classify: "invoice", extract: [{ vendor: "Sysco", amount: 1002.98 }] });
    const usable = usableExtraction({ extraction: stored, extraction_version: EXTRACTION_VERSION });
    expect(usable.ok).toBe(true);
    expect(proc).toContain("prior?.extraction?.classify");
    expect(proc).toContain("prior?.extraction?.extract");
    expect(usable.extraction.classify).toBe("invoice");
    expect(usable.extraction.extract).toEqual([{ vendor: "Sysco", amount: 1002.98 }]);
  });

  it("the coding call is still made on a cache hit — the account is never reused", () => {
    const inv = proc.slice(proc.indexOf('if (docType === "invoice") {'));
    const hit = inv.indexOf("if (cachedExtract) {");
    const coding = inv.indexOf('profile: "code-invoices-batch"');
    expect(hit).toBeGreaterThan(0);
    expect(coding).toBeGreaterThan(hit);            // reached after the branch, not inside the else
    expect(inv.slice(hit, inv.indexOf("} else {", hit))).not.toContain("code-invoices-batch");
  });
});
