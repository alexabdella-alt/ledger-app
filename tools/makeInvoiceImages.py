#!/usr/bin/env python3
"""
Invoice images for the volume drive (roadmap item 12).

WHAT THESE ARE, AND WHAT THEY ARE NOT
-------------------------------------
Eight drives so far have been bank-statement-shaped. A new client arrives with a pile of
invoices, and that path has never been tested. These give you something to drop TODAY rather
than waiting to assemble a real month.

*** They are SYNTHETIC, and that bounds what a clean result proves. ***
They exercise extraction and COLD-START CATEGORISATION on plausible documents — which is the
riskiest part, because the system has never seen these vendors and has to decide what each
charge is from nothing. They do NOT exercise the real long tail: unusual layouts, foreign
templates, faxed pages, three-page invoices, genuinely bad handwriting. A pass here is
evidence about categorisation, not about parse robustness. Say so when reading the result.

Deliberate variety, so it is not uniformly easy:
  · three different layouts (formal invoice / thermal receipt / utility statement)
  · date formats that differ per vendor, including one written "Aug 14, 2026"
  · one invoice whose OBVIOUS keyword reading is WRONG (see ALAMO below)
  · photo-like degradation: rotation, uneven lighting, noise, JPEG artefacts

    python3 tools/makeInvoiceImages.py
"""
import os, math, random
from PIL import Image, ImageDraw, ImageFont, ImageFilter

random.seed(20260901)                      # deterministic — the same pile every run
OUT = os.path.join(os.path.dirname(__file__), "drive-fixtures")
F = "/System/Library/Fonts/Supplemental/"

def font(name, size):
    for p in (F + name, "/System/Library/Fonts/" + name):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()

BOLD, REG, MONO = "Arial Bold.ttf", "Arial.ttf", "Courier New.ttf"

# ── the pile ────────────────────────────────────────────────────────────────
# `expect` is what a competent bookkeeper would say — it is NOT shown to the app; it is the
# answer key you score against afterwards.
INVOICES = [
    dict(vendor="Rio Grande Produce Co.", layout="invoice", num="RG-44182", date="08/04/2026",
         terms="Net 15", items=[("Roma tomatoes, 40 lb case", 3, 38.50), ("Yellow onions, 50 lb", 2, 31.25),
                                 ("Cilantro, 30 ct", 4, 12.00), ("Delivery", 1, 25.00)],
         expect="Food cost / COGS"),
    dict(vendor="Alamo Ice & Beverage", layout="invoice", num="AIB-9071", date="08/06/2026",
         terms="Net 30", items=[("CO2 tank exchange, 20 lb", 4, 42.00), ("Bagged ice, 20 lb", 60, 3.10),
                                 ("Fountain syrup, BIB cola", 6, 78.40)],
         expect="COGS — this is drinks inventory, NOT equipment. The words 'tank' and "
                "'exchange' read like equipment; a past drive put a vendor like this in "
                "Miscellaneous. Watch this one."),
    dict(vendor="Guadalupe Waste Services", layout="statement", num="000418822", date="Aug 1, 2026",
         terms="Due on receipt", items=[("Commercial dumpster, 4 yd — monthly", 1, 385.00),
                                        ("Extra pickup 07/22", 1, 65.00), ("Fuel surcharge", 1, 18.50)],
         expect="Waste removal — an operating expense, not COGS"),
    dict(vendor="Barton Springs Repair Co.", layout="invoice", num="8841", date="08/11/2026",
         terms="Net 15", items=[("Service call — walk-in cooler", 1, 145.00),
                                 ("Compressor capacitor", 1, 88.75), ("Labor, 2.5 hrs @ $95", 1, 237.50)],
         expect="Repairs & maintenance. A REPAIR, not a capital improvement — it restores "
                "the cooler, it does not extend its life"),
    dict(vendor="Hill Country Milling Co.", layout="invoice", num="HC-20419", date="08/12/2026",
         terms="Net 30", items=[("00 flour, 50 lb", 12, 34.80), ("Semolina, 50 lb", 4, 41.20),
                                 ("Freight", 1, 62.00)],
         expect="Food cost / COGS"),
    dict(vendor="Lone Star Restaurant Supply", layout="invoice", num="LS-77310", date="08/13/2026",
         terms="Net 30", items=[("Sheet pans, half size", 24, 11.40), ("Deli containers, 32 oz, case", 6, 44.90),
                                 ("Nitrile gloves, case", 3, 58.00)],
         expect="Operating supplies — NOT food cost, and NOT equipment at these amounts"),
    dict(vendor="Texas Mutual Insurance", layout="statement", num="POL-4471902", date="08/01/2026",
         terms="Auto-draft", items=[("Workers' compensation — August premium", 1, 890.00)],
         expect="Insurance"),
    dict(vendor="Half Moon Creative", layout="invoice", num="HM-1142", date="Aug 14, 2026",
         terms="Net 30", items=[("Menu photography — half day", 1, 650.00), ("Retouching, 12 images", 1, 180.00)],
         expect="Marketing / advertising"),
    dict(vendor="CORNER MARKET #221", layout="receipt", num="TRX 88104", date="08/15/2026",
         terms="", items=[("Lemons", 1, 14.88), ("Kosher salt 3lb", 2, 6.49),
                          ("Paper towels 12pk", 1, 22.99), ("Sharpie 4pk", 1, 8.49)],
         expect="A SMALL MIXED RECEIPT — some food, some supplies. A bookkeeper would not "
                "split $52; watch whether it picks something sensible or asks"),
    dict(vendor="Austin Municipal Utilities", layout="statement", num="ACCT 7719-004", date="08/02/2026",
         terms="Due 08/25/2026", items=[("Electric service 07/01–07/31", 1, 1180.44),
                                        ("Water & wastewater", 1, 296.10), ("Regulatory fee", 1, 14.20)],
         expect="Utilities"),
    dict(vendor="Bluebonnet Linen Service", layout="invoice", num="BLS-90233", date="08/17/2026",
         terms="Weekly", items=[("Bar mops, 100 ct", 1, 62.00), ("Aprons, 40 ct", 1, 48.00),
                                 ("Kitchen mats — rotation", 1, 35.00)],
         expect="Laundry / linen. FLAT WEEKLY VENDOR — should be routine, never a duplicate flag"),
    dict(vendor="Franklin Ave Properties LP", layout="statement", num="RENT-0826", date="08/01/2026",
         terms="Due on the 1st", items=[("Base rent — August 2026", 1, 4200.00),
                                        ("CAM reconciliation", 1, 312.75)],
         expect="Rent & occupancy. LARGE AND ENTIRELY ROUTINE — must not be flagged as an "
                "unusual charge"),
    dict(vendor="Pecan Street Fire & Safety", layout="invoice", num="PS-3318", date="08/19/2026",
         terms="Net 30", items=[("Hood suppression — semi-annual inspection", 1, 285.00),
                                 ("Extinguisher recharge, 4 units", 1, 96.00)],
         expect="Repairs & maintenance or a compliance expense — NOT capitalised"),
    dict(vendor="Sabine Kitchen Equipment", layout="invoice", num="SKE-6620", date="08/21/2026",
         terms="Net 30", items=[("Reach-in freezer, 49 cu ft", 1, 4285.00), ("Delivery & install", 1, 340.00)],
         expect="THE ONE THAT SHOULD ASK. $4,625 of equipment lasting over a year — this is "
                "the capitalise-or-expense question, and it SHOULD stop and ask"),
]

W, H = 1000, 1400
INK, PAPER = (28, 28, 32), (252, 251, 248)

def money(n): return f"${n:,.2f}"

def draw_invoice(d, inv, subtotal, tax, total):
    d.text((60, 70), inv["vendor"].upper(), font=font(BOLD, 34), fill=INK)
    d.text((60, 118), "INVOICE", font=font(REG, 20), fill=(110, 110, 120))
    d.text((640, 74), f"Invoice #  {inv['num']}", font=font(MONO, 18), fill=INK)
    d.text((640, 102), f"Date       {inv['date']}", font=font(MONO, 18), fill=INK)
    if inv["terms"]: d.text((640, 130), f"Terms      {inv['terms']}", font=font(MONO, 18), fill=INK)
    d.line([(60, 175), (940, 175)], fill=(180, 180, 190), width=2)
    d.text((60, 200), "Bill to:  Franklin Ave Pizza LLC", font=font(REG, 17), fill=(90, 90, 100))
    d.text((60, 224), "          1811 Franklin Ave, Austin TX 78702", font=font(REG, 17), fill=(90, 90, 100))
    y = 300
    d.text((60, y), "DESCRIPTION", font=font(BOLD, 15), fill=(110, 110, 120))
    d.text((600, y), "QTY", font=font(BOLD, 15), fill=(110, 110, 120))
    d.text((700, y), "RATE", font=font(BOLD, 15), fill=(110, 110, 120))
    d.text((850, y), "AMOUNT", font=font(BOLD, 15), fill=(110, 110, 120))
    y += 30; d.line([(60, y), (940, y)], fill=(200, 200, 210), width=1); y += 22
    for desc, qty, rate in inv["items"]:
        d.text((60, y), desc, font=font(REG, 19), fill=INK)
        d.text((600, y), str(qty), font=font(MONO, 18), fill=INK)
        d.text((700, y), money(rate), font=font(MONO, 18), fill=INK)
        d.text((850, y), money(qty * rate), font=font(MONO, 18), fill=INK)
        y += 38
    y += 20; d.line([(600, y), (940, y)], fill=(200, 200, 210), width=1); y += 18
    d.text((700, y), "Subtotal", font=font(REG, 18), fill=INK); d.text((850, y), money(subtotal), font=font(MONO, 18), fill=INK); y += 30
    if tax: d.text((700, y), "Sales tax", font=font(REG, 18), fill=INK); d.text((850, y), money(tax), font=font(MONO, 18), fill=INK); y += 30
    d.text((700, y + 6), "TOTAL DUE", font=font(BOLD, 21), fill=INK)
    d.text((850, y + 6), money(total), font=font(BOLD, 21), fill=INK)
    d.text((60, 1300), "Thank you for your business.", font=font(REG, 16), fill=(140, 140, 150))

def draw_statement(d, inv, subtotal, tax, total):
    d.rectangle([(0, 0), (W, 130)], fill=(238, 237, 244))
    d.text((60, 40), inv["vendor"], font=font(BOLD, 30), fill=INK)
    d.text((60, 82), "STATEMENT OF ACCOUNT", font=font(REG, 16), fill=(110, 110, 120))
    d.text((60, 175), f"Account  {inv['num']}", font=font(MONO, 18), fill=INK)
    d.text((60, 203), f"Statement date  {inv['date']}", font=font(MONO, 18), fill=INK)
    if inv["terms"]: d.text((60, 231), f"{inv['terms']}", font=font(MONO, 18), fill=INK)
    d.text((60, 300), "Service address:  1811 Franklin Ave, Austin TX 78702", font=font(REG, 17), fill=(90, 90, 100))
    y = 380
    for desc, qty, rate in inv["items"]:
        d.text((60, y), desc, font=font(REG, 19), fill=INK)
        d.text((820, y), money(qty * rate), font=font(MONO, 19), fill=INK)
        y += 42
    y += 10; d.line([(60, y), (940, y)], fill=(190, 190, 200), width=2); y += 24
    if tax: d.text((60, y), "Taxes & fees", font=font(REG, 18), fill=INK); d.text((820, y), money(tax), font=font(MONO, 18), fill=INK); y += 34
    d.rectangle([(56, y - 6), (944, y + 46)], fill=(238, 237, 244))
    d.text((60, y + 8), "AMOUNT DUE", font=font(BOLD, 22), fill=INK)
    d.text((790, y + 8), money(total), font=font(BOLD, 22), fill=INK)

def draw_receipt(d, inv, subtotal, tax, total):
    cx = W // 2
    def ctr(t, yy, f, fill=INK):
        w = d.textlength(t, font=f); d.text((cx - w / 2, yy), t, font=f, fill=fill)
    ctr(inv["vendor"], 120, font(BOLD, 30))
    ctr("1900 E 6th St  Austin TX", 165, font(MONO, 18), (90, 90, 100))
    ctr("-" * 34, 205, font(MONO, 20), (150, 150, 160))
    ctr(f"{inv['date']}    {inv['num']}", 240, font(MONO, 18))
    ctr("-" * 34, 275, font(MONO, 20), (150, 150, 160))
    y = 320
    for desc, qty, rate in inv["items"]:
        d.text((190, y), desc[:26], font=font(MONO, 20), fill=INK)
        d.text((700, y), money(qty * rate), font=font(MONO, 20), fill=INK)
        y += 40
    y += 10; ctr("-" * 34, y, font(MONO, 20), (150, 150, 160)); y += 40
    d.text((190, y), "SUBTOTAL", font=font(MONO, 20), fill=INK); d.text((700, y), money(subtotal), font=font(MONO, 20), fill=INK); y += 36
    d.text((190, y), "TAX", font=font(MONO, 20), fill=INK); d.text((700, y), money(tax), font=font(MONO, 20), fill=INK); y += 44
    d.text((190, y), "TOTAL", font=font(BOLD, 24), fill=INK); d.text((690, y), money(total), font=font(BOLD, 24), fill=INK)
    ctr("VISA ****4419   APPROVED", y + 70, font(MONO, 18), (90, 90, 100))
    ctr("*** CUSTOMER COPY ***", y + 110, font(MONO, 18), (120, 120, 130))

def photograph(img, i):
    """Make it look like a phone photo rather than a print-to-PDF."""
    img = img.rotate(random.uniform(-1.8, 1.8), expand=True, fillcolor=(246, 245, 242), resample=Image.BICUBIC)
    # uneven lighting — a soft gradient across the page, as a window would cast
    grad = Image.new("L", img.size)
    gd = ImageDraw.Draw(grad)
    for x in range(0, img.size[0], 4):
        gd.rectangle([(x, 0), (x + 4, img.size[1])], fill=int(236 + 19 * math.sin(x / img.size[0] * 2.6 + i)))
    img = Image.composite(img, Image.new("RGB", img.size, (255, 255, 255)), grad)
    if i % 4 == 0: img = img.filter(ImageFilter.GaussianBlur(0.4))     # one in four slightly soft
    px = img.load()                                                    # sensor noise
    for _ in range(int(img.size[0] * img.size[1] * 0.004)):
        x, y = random.randrange(img.size[0]), random.randrange(img.size[1])
        n = random.randint(-16, 16)
        r, g, b = px[x, y]
        px[x, y] = (max(0, min(255, r + n)), max(0, min(255, g + n)), max(0, min(255, b + n)))
    return img

os.makedirs(OUT, exist_ok=True)
key = ["# ANSWER KEY — what a competent bookkeeper would say. Score against this AFTER the run.",
       "# These are SYNTHETIC: they test extraction and cold-start categorisation on plausible",
       "# documents, NOT the real long tail of layouts. A clean pass is evidence about",
       "# categorisation, not about parse robustness.", ""]

for i, inv in enumerate(INVOICES, 1):
    img = Image.new("RGB", (W, H), PAPER)
    d = ImageDraw.Draw(img)
    subtotal = round(sum(q * r for _, q, r in inv["items"]), 2)
    tax = round(subtotal * 0.0825, 2) if inv["layout"] == "receipt" else 0.0
    total = round(subtotal + tax, 2)
    {"invoice": draw_invoice, "statement": draw_statement, "receipt": draw_receipt}[inv["layout"]](d, inv, subtotal, tax, total)
    img = photograph(img, i)
    slug = "".join(c if c.isalnum() else "-" for c in inv["vendor"].lower()).strip("-")[:34]
    name = f"{i:02d}-{slug}.jpg"
    img.save(os.path.join(OUT, name), "JPEG", quality=random.choice([72, 80, 88]))
    key.append(f"{name}\n    vendor : {inv['vendor']}\n    total  : {money(total)}\n    expect : {inv['expect']}\n")

open(os.path.join(OUT, "ANSWER-KEY.txt"), "w").write("\n".join(key))
print(f"{len(INVOICES)} invoice images + ANSWER-KEY.txt → {OUT}")
