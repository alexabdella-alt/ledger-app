"""
Renders the five niche test months in tools/niches/*.json as photographed-looking paperwork,
one folder per niche under tools/niche-fixtures/, each with an ANSWER-KEY.txt.

    python3 tools/makeNicheMonths.py            # all five
    python3 tools/makeNicheMonths.py coach      # one

★ THE JSON IS THE SOURCE OF TRUTH. The same files feed tests/nicheMonths.test.js, which checks
each month against the app's own category sets and answer logic OFFLINE — so the gaps are
known before a live run, and the live run tests what only a live run can: reading the image.

★ SYNTHETIC, like makeInvoiceImages.py: a clean result is evidence about categorisation and
accounting treatment on plausible documents, NOT about parse robustness on the real long tail.

★ REPRODUCIBLE BY CONSTRUCTION. No built-in hash() (salted per process — the defect C552 found
in the restaurant generator); every random choice comes from a Random seeded with a CRC of the
niche and the document's position, so a document renders the same whatever else changes.
"""
import json, os, sys, zlib, random
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "niches")
OUT = os.path.join(HERE, "niche-fixtures")
F = "/System/Library/Fonts/Supplemental/"
W, H = 1000, 1400
INK, PAPER, MUTED = (28, 28, 32), (252, 251, 248), (90, 90, 100)

def stable(*parts):
    return zlib.crc32(repr(parts).encode("utf-8"))

def font(name, size):
    for p in (F + name, "/System/Library/Fonts/" + name):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()

BOLD, REG, MONO = "Arial Bold.ttf", "Arial.ttf", "Courier New.ttf"

def money(n):
    return f"-${abs(n):,.2f}" if n < 0 else f"${n:,.2f}"

def totals(doc):
    sub = round(sum(q * r for _, q, r in doc["items"]), 2)
    tax = round(sub * doc.get("tax_rate", 0), 2) if doc.get("tax_rate") else 0.0
    return sub, tax, round(sub + tax, 2)

def slug(s):
    return "".join(c if c.isalnum() else "-" for c in s.lower()).strip("-")[:40]

def header(d, top, sub_lines, right):
    # A long name must not run into the right-hand block (x=640): overlapping text would make
    # the live run a test of this generator's layout rather than of the app's reading.
    size = 32
    while size > 16 and d.textlength(top.upper(), font=font(BOLD, size)) > 560:
        size -= 1
    d.text((60, 70), top.upper(), font=font(BOLD, size), fill=INK)
    y = 120
    for line in sub_lines:
        d.text((60, y), line, font=font(REG, 17), fill=MUTED); y += 24
    ry = 70
    for line in right:
        d.text((640, ry), line, font=font(REG, 18), fill=INK); ry += 28
    return max(y, ry) + 30

def lines_block(d, doc, y, desc_x=60, amt_x=820, show_qty=True):
    d.line((60, y, 940, y), fill=INK, width=2); y += 12
    d.text((desc_x, y), "Description", font=font(BOLD, 17), fill=INK)
    if show_qty:
        d.text((560, y), "Qty", font=font(BOLD, 17), fill=INK); d.text((640, y), "Rate", font=font(BOLD, 17), fill=INK)
    d.text((amt_x, y), "Amount", font=font(BOLD, 17), fill=INK); y += 34
    for desc, qty, rate in doc["items"]:
        d.text((desc_x, y), desc[:58], font=font(REG, 17), fill=INK)
        if show_qty:
            d.text((560, y), f"{qty:g}", font=font(MONO, 17), fill=INK); d.text((640, y), money(rate), font=font(MONO, 17), fill=INK)
        d.text((amt_x, y), money(round(qty * rate, 2)), font=font(MONO, 17), fill=INK); y += 30
    return y + 10

def draw(doc, company):
    img = Image.new("RGB", (W, H), PAPER); d = ImageDraw.Draw(img)
    sub, tax, total = totals(doc)
    lay = doc["layout"]
    if lay == "receipt":
        x = 190
        d.text((x, 90), doc["party"].upper(), font=font(BOLD, 28), fill=INK)
        d.text((x, 140), f"{doc['date']}   #{doc['number']}", font=font(MONO, 20), fill=INK); y = 200
        for desc, qty, rate in doc["items"]:
            d.text((x, y), f"{desc[:30]:<30}", font=font(MONO, 20), fill=INK)
            d.text((700, y), money(round(qty * rate, 2)), font=font(MONO, 20), fill=INK); y += 34
        y += 20
        d.text((x, y), "SUBTOTAL", font=font(MONO, 20), fill=INK); d.text((700, y), money(sub), font=font(MONO, 20), fill=INK); y += 36
        d.text((x, y), "TAX", font=font(MONO, 20), fill=INK); d.text((700, y), money(tax), font=font(MONO, 20), fill=INK); y += 44
        d.text((x, y), "TOTAL", font=font(BOLD, 24), fill=INK); d.text((690, y), money(total), font=font(BOLD, 24), fill=INK); y += 50
        d.text((x, y), "VISA ****4417   APPROVED", font=font(MONO, 18), fill=MUTED)
        return img, total
    if lay == "our_invoice":
        y = header(d, company["name"], [company["address"]], ["INVOICE", f"No. {doc['number']}", f"Date: {doc['date']}"])
        d.text((60, y), f"Bill to:  {doc['party']}", font=font(REG, 18), fill=INK); y += 50
    elif lay == "card_statement":
        y = header(d, doc["party"], [f"Cardholder: {company['name']}", company["address"]], ["STATEMENT", f"Closing date: {doc['date']}", f"Ref {doc['number']}"])
    else:
        title = "INVOICE" if lay == "invoice" else "STATEMENT"
        y = header(d, doc["party"], [f"{'Bill to' if lay == 'invoice' else 'Account'}:  {company['name']}", company["address"]],
                   [title, f"No. {doc['number']}", f"Date: {doc['date']}"])
    if doc.get("terms"):
        d.text((60, y), f"Terms: {doc['terms']}", font=font(REG, 17), fill=MUTED); y += 36
    y = lines_block(d, doc, y, show_qty=(lay != "card_statement"))
    d.line((560, y, 940, y), fill=INK, width=1); y += 14
    if tax:
        d.text((600, y), "Sales tax", font=font(REG, 18), fill=INK); d.text((820, y), money(tax), font=font(MONO, 18), fill=INK); y += 32
    label = doc.get("total_label") or ("Amount due" if lay in ("invoice", "our_invoice") else "Total")
    d.text((560, y + 4), label, font=font(BOLD, 20), fill=INK); d.text((820, y + 4), money(total), font=font(BOLD, 21), fill=INK)
    return img, total

def photograph(img, rng):
    img = img.rotate(rng.uniform(-1.6, 1.6), expand=True, fillcolor=(246, 245, 242), resample=Image.BICUBIC)
    px = img.load()
    for _ in range(9000):
        x, y = rng.randrange(img.size[0]), rng.randrange(img.size[1])
        n = rng.randint(-14, 14); r, g, b = px[x, y]
        px[x, y] = (max(0, min(255, r + n)), max(0, min(255, g + n)), max(0, min(255, b + n)))
    return img.filter(ImageFilter.GaussianBlur(rng.choice([0, 0.4, 0.7])))

def render(niche_file):
    spec = json.load(open(os.path.join(SRC, niche_file)))
    niche, company = spec["niche"], spec["company"]
    out = os.path.join(OUT, niche); os.makedirs(out, exist_ok=True)
    for f in os.listdir(out):
        os.remove(os.path.join(out, f))
    key = [f"# ANSWER KEY — {spec['label']} — {company['name']} ({company['business_type']})",
           f"# {company['form']}",
           "# Read AFTER the run. SYNTHETIC documents: evidence about categorisation and treatment,",
           "# not about reading messy real-world paperwork.", ""]
    for i, doc in enumerate(spec["documents"], 1):
        name = f"{i:02d}-{slug(doc['party'])}.jpg"
        img, total = draw(doc, company)
        rng = random.Random(stable(niche, i))
        photograph(img, rng).save(os.path.join(out, name), "JPEG", quality=rng.choice([74, 82, 88]))
        roles = " + ".join("/".join(s) if isinstance(s, list) else s for s in doc["expect"])
        key.append(f"{name}\n    from/to : {doc['party']}  ·  {doc['date']}\n    total   : {money(total)}\n"
                   f"    expect  : {doc['treatment']}  [{roles}]")
        if doc.get("planted"):
            key.append(f"    ★ WATCH : {doc['planted']}")
        key.append("")
    open(os.path.join(out, "ANSWER-KEY.txt"), "w").write("\n".join(key))
    print(f"{niche}: {len(spec['documents'])} documents → {out}")

if __name__ == "__main__":
    wanted = sys.argv[1:]
    for f in sorted(os.listdir(SRC)):
        if f.endswith(".json") and (not wanted or f[:-5] in wanted):
            render(f)
