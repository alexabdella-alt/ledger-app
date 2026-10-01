import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ═════════════════════════════════════════════════════════════════════════════
// THE INVOICE DRIVE'S GENERATOR (tools/makeInvoiceImages.py) — three things it got wrong,
// found 2026-10-01 while preparing drive 4. The generator is Python and does not run in this
// suite, so these read its SOURCE; the behaviour was proven by running it (see the C552 note).
//
//  1. "deterministic — the same pile every run" was half true: the wobble and the invoice
//     numbers used Python's string hash, salted per process. The same invoice came out at
//     $138.72 under one hash seed and $137.14 under another.
//  2. Bluebonnet Linen was PLANTED as the flat weekly fee (O117/O127) and then wobbled with
//     everyone else, ~3% apart — over the 2% bar the flat-fee rule uses. Three drives ran
//     without the planted case ever being in the pile.
//  3. The bill-to named the company the first three drives used, so a fresh company for
//     drive 4 would have collided with it in the switcher.
// ═════════════════════════════════════════════════════════════════════════════

const src = fs.readFileSync(path.join(process.cwd(), "tools/makeInvoiceImages.py"), "utf8");
const code = src.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");

describe("the drive generator stays reproducible and keeps its planted cases", () => {
  it("★★★ no salted string hash decides an amount or an invoice number", () => {
    expect(code).not.toMatch(/\bhash\(/);
    expect(code).toMatch(/def stable\(\*parts\):\s*\n\s*return zlib\.crc32\(/);
    expect(code).toMatch(/stable\(desc, k\)/);
    expect(code).toMatch(/stable\(pre, day\)/);
  });

  it("★★★ Bluebonnet bills the identical amount every week", () => {
    expect(code).toMatch(/FLAT = \{"BLS"\}/);
    expect(code).toMatch(/items=items if pre in FLAT else wobble\(items, k\)/);
    // and its line items still sum to the $145.00 the flat-fee spec and demo company use
    const m = src.match(/\("Bluebonnet Linen Service", "invoice", \[[^\]]+\],\s*\[([^\]]+)\]/);
    expect(m, "Bluebonnet's row moved — re-aim this, do not delete it").toBeTruthy();
    const total = [...m[1].matchAll(/\("[^"]+", (\d+), ([\d.]+)\)/g)].reduce((t, x) => t + Number(x[1]) * Number(x[2]), 0);
    expect(Math.round(total * 100) / 100).toBe(145);
  });

  it("★ the bill-to is one constant, read where it is drawn", () => {
    expect(code).toMatch(/BILL_TO = "Riverbend Pizza Co\."/);
    expect(code).toMatch(/f"Bill to:  \{BILL_TO\}"/);
    expect(code).not.toMatch(/Bill to:  Red River Pizza Co/);
  });
});
