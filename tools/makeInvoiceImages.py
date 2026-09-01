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

# ── the month ───────────────────────────────────────────────────────────────
# A real month is NOT fourteen unique vendors — it is the same suppliers arriving again and
# again, with a handful of one-offs. That difference is the whole point of running this at
# volume rather than at variety:
#   · repeats test whether the questions TAPER as a vendor becomes familiar. A vendor asked
#     about on the 4th and again on the 25th is a defect, not a question (O122).
#   · volume tests what the queue does when the pile is longer than the hourly budget —
#     behaviour that changed with the rolling window and has never been watched on a backlog.
#
# `expect` is what a competent bookkeeper would say. It is NOT shown to the app; it is the
# answer key, to be read AFTER the run.

RECURRING = [
    # vendor, layout, days of the month, line items, expectation, invoice prefix
    ("Rio Grande Produce Co.", "invoice", [4, 11, 18, 25],
     [("Roma tomatoes, 40 lb case", 3, 38.50), ("Yellow onions, 50 lb", 2, 31.25),
      ("Cilantro, 30 ct", 4, 12.00), ("Delivery", 1, 25.00)],
     "Food cost / COGS", "RG"),
    ("Hill Country Milling Co.", "invoice", [5, 12, 19, 26],
     [("00 flour, 50 lb", 12, 34.80), ("Semolina, 50 lb", 4, 41.20), ("Freight", 1, 62.00)],
     "Food cost / COGS", "HC"),
    ("Alamo Ice & Beverage", "invoice", [6, 13, 20, 27],
     [("CO2 tank exchange, 20 lb", 4, 42.00), ("Bagged ice, 20 lb", 60, 3.10),
      ("Fountain syrup, BIB cola", 6, 78.40)],
     "COGS — drinks inventory, NOT equipment. 'tank' and 'exchange' read like equipment; a "
     "vendor of this shape once landed in Miscellaneous. AND it repeats weekly: if it asks "
     "on the 6th that is fair, if it asks again on the 27th that is a defect", "AIB"),
    ("Bluebonnet Linen Service", "invoice", [3, 10, 17, 24],
     [("Bar mops, 100 ct", 1, 62.00), ("Aprons, 40 ct", 1, 48.00), ("Kitchen mats — rotation", 1, 35.00)],
     "Laundry / linen. FLAT WEEKLY — identical every week, so it must never read as a "
     "duplicate payment", "BLS"),
    ("Sysco Central Texas", "invoice", [7, 21],
     [("Mozzarella, 6/5 lb", 8, 41.90), ("Pepperoni, 2/12.5 lb", 4, 68.25),
      ("Olive oil, 6/1 gal", 3, 96.00), ("Napkins, 6000 ct", 2, 54.30)],
     "Food cost / COGS", "SYS"),
    ("Corner Market #221", "receipt", [8, 15, 22, 29],
     [("Lemons", 1, 14.88), ("Kosher salt 3lb", 2, 6.49), ("Paper towels 12pk", 1, 22.99),
      ("Sharpie 4pk", 1, 8.49)],
     "A SMALL MIXED RECEIPT — some food, some supplies. A bookkeeper would not split $60; "
     "watch whether it picks something sensible or asks", "TRX"),
]

MONTHLY = [
    ("Franklin Ave Properties LP", "statement", 1,
     [("Base rent — August 2026", 1, 4200.00), ("CAM reconciliation", 1, 312.75)],
     "Rent & occupancy. LARGE AND ENTIRELY ROUTINE — must NOT be flagged as an unusual "
     "charge (that is the C291 fix, met on realistic data)", "RENT"),
    ("Austin Municipal Utilities", "statement", 2,
     [("Electric service 07/01–07/31", 1, 1180.44), ("Water & wastewater", 1, 296.10),
      ("Regulatory fee", 1, 14.20)], "Utilities", "ACCT"),
    ("Texas Mutual Insurance", "statement", 1,
     [("Workers' compensation — August premium", 1, 890.00)], "Insurance", "POL"),
    ("Guadalupe Waste Services", "statement", 1,
     [("Commercial dumpster, 4 yd — monthly", 1, 385.00), ("Extra pickup 07/22", 1, 65.00),
      ("Fuel surcharge", 1, 18.50)], "Waste removal — operating expense, not COGS", "GWS"),
    ("Lone Star Restaurant Supply", "invoice", 9,
     [("Sheet pans, half size", 24, 11.40), ("Deli containers, 32 oz, case", 6, 44.90),
      ("Nitrile gloves, case", 3, 58.00)],
     "Operating supplies — NOT food cost, and NOT equipment at these amounts", "LS"),
    ("Half Moon Creative", "invoice", 14,
     [("Menu photography — half day", 1, 650.00), ("Retouching, 12 images", 1, 180.00)],
     "Marketing / advertising", "HM"),
    ("Gusto", "statement", 15,
     [("Payroll — period ending 08/14", 1, 5500.00), ("Employer taxes", 1, 421.00),
      ("Platform fee", 1, 46.00)],
     "PAYROLL — should route to the payroll path, not be booked as a supplier bill", "GUS"),
]

ONE_OFFS = [
    ("Barton Springs Repair Co.", "invoice", 11,
     [("Service call — walk-in cooler", 1, 145.00), ("Compressor capacitor", 1, 88.75),
      ("Labor, 2.5 hrs @ $95", 1, 237.50)],
     "Repairs & maintenance. A REPAIR — it restores the cooler, it does not extend its life", "BSR"),
    ("Pecan Street Fire & Safety", "invoice", 19,
     [("Hood suppression — semi-annual inspection", 1, 285.00),
      ("Extinguisher recharge, 4 units", 1, 96.00)],
     "Repairs & maintenance or compliance — NOT capitalised", "PS"),
    ("Sabine Kitchen Equipment", "invoice", 21,
     [("Reach-in freezer, 49 cu ft", 1, 4285.00), ("Delivery & install", 1, 340.00)],
     "THE ONE THAT SHOULD ASK. $4,625 of equipment lasting over a year — capitalise or "
     "expense is a real judgement and it SHOULD stop", "SKE"),
    ("Travis County Tax Office", "statement", 20,
     [("Mixed beverage gross receipts tax — July", 1, 1043.88)],
     "A TAX REMITTANCE, not an expense of the month it is paid in. Watch this one", "TCT"),
    ("Zilker Pest Control", "invoice", 26,
     [("Monthly service — kitchen & dry storage", 1, 145.00)],
     "Repairs & maintenance / facilities", "ZPC"),
    ("Waterloo Signs", "invoice", 27,
     [("Window decal — new hours", 1, 240.00), ("Installation", 1, 95.00)],
     "Marketing, or repairs — genuinely arguable at $335, so either is defensible", "WS"),
]

def wobble(items, k):
    """Real invoices from one vendor are not identical week to week."""
    out = []
    for desc, qty, rate in items:
        r = round(rate * (1 + ((hash((desc, k)) % 21) - 10) / 100.0), 2)
        out.append((desc, qty, r))
    return out

INVOICES = []
for vendor, layout, days, items, expect, pre in RECURRING:
    for k, day in enumerate(days):
        INVOICES.append(dict(vendor=vendor, layout=layout, num=f"{pre}-{40000 + hash((pre, day)) % 9000}",
                             date=f"08/{day:02d}/2026", terms="Net 30" if layout == "invoice" else "",
                             items=wobble(items, k), expect=expect))
for vendor, layout, day, items, expect, pre in MONTHLY + ONE_OFFS:
    date = "Aug 14, 2026" if pre == "HM" else f"08/{day:02d}/2026"
    INVOICES.append(dict(vendor=vendor, layout=layout, num=f"{pre}-{10000 + hash((pre, day)) % 9000}",
                         date=date, terms="Net 30" if layout == "invoice" else "Due on receipt",
                         items=items, expect=expect))
INVOICES.sort(key=lambda x: (x["date"][-4:], x["date"][:2], x["date"][3:5]))

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
    d.text((60, 200), "Bill to:  Red River Pizza Co.", font=font(REG, 17), fill=(90, 90, 100))
    d.text((60, 224), "          2401 Red River St, Austin TX 78705", font=font(REG, 17), fill=(90, 90, 100))
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
    d.text((60, 300), "Service address:  2401 Red River St, Austin TX 78705", font=font(REG, 17), fill=(90, 90, 100))
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
