"""Step 2: turn the cached DAAD pages into the site's data files.

  data/programmes.js        light index used by search/filters (window.STUDYBAHN)
  data/details/<id>.js      full detail per programme, loaded on demand

Both are plain <script> files so the site also works opened from disk (file://).
Usage:  python scripts/build.py
"""
import html as htmllib
import json
import re
from datetime import date
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = Path(__file__).parent / ".cache"
OUT = ROOT / "data"
DAAD = "https://www2.daad.de"
DAAD_DETAIL = DAAD + "/deutschland/studienangebote/international-programmes/en/detail/{}/"

SUBJECT_GROUPS = {
    1: "Agricultural and Forest Sciences",
    146: "Art, Music, Design",
    380: "Economic Sciences, Law",
    56: "Engineering Sciences",
    17: "Humanities and Social Sciences",
    273: "Language and Cultural Studies",
    193: "Mathematics, Natural Sciences",
    255: "Medicine, Health Sciences",
    382: "Public Administration",
    381: "Teaching Degrees",
}
MONTHS = {m: i + 1 for i, m in enumerate(
    "january february march april may june july august september october november december".split())}
CEFR = ["A1", "A2", "B1", "B2", "C1", "C2"]


# ---------------------------------------------------------------- HTML utils
class Sanitizer(HTMLParser):
    """Keep a small, safe subset of tags; drop all attributes but href."""
    KEEP = {"p", "br", "ul", "ol", "li", "strong", "b", "em", "i", "a", "h4", "h5", "table", "tr", "td", "th", "tbody", "thead"}
    VOID = {"br"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "svg"):
            self.skip += 1
            return
        if self.skip or tag not in self.KEEP:
            return
        if tag == "a":
            href = dict(attrs).get("href") or ""
            if href.startswith("/"):
                href = DAAD + href
            if not re.match(r"^(https?:|mailto:)", href):
                self.out.append("<a>")
                return
            self.out.append(f'<a href="{htmllib.escape(href, quote=True)}" target="_blank" rel="noopener">')
            return
        self.out.append(f"<{'strong' if tag == 'b' else tag}>")

    def handle_endtag(self, tag):
        if tag in ("script", "style", "svg"):
            self.skip = max(0, self.skip - 1)
            return
        if self.skip or tag not in self.KEEP or tag in self.VOID:
            return
        self.out.append(f"</{'strong' if tag == 'b' else tag}>")

    def handle_data(self, data):
        if not self.skip:
            self.out.append(htmllib.escape(data, quote=False))


def clean_html(raw):
    s = Sanitizer()
    s.feed(raw)
    s.close()
    out = "".join(s.out)
    out = re.sub(r"\s+", " ", out)
    out = re.sub(r"(<br>\s*){3,}", "<br><br>", out)
    out = re.sub(r"<p>\s*</p>", "", out)
    return out.strip()


def text(raw):
    return re.sub(r"\s+", " ", htmllib.unescape(re.sub(r"<[^>]+>", " ", raw))).strip()


def pane(page, pane_id):
    m = re.search(rf'<div class="tab-pane[^"]*" id="{pane_id}"', page)
    if not m:
        return ""
    nxt = re.search(r'<div class="tab-pane', page[m.end():])
    return page[m.end(): m.end() + nxt.start()] if nxt else page[m.end():]


def dl_pairs(chunk):
    pairs = []
    for m in re.finditer(r"<dt[^>]*>(.*?)</dt>\s*<dd[^>]*>(.*?)</dd>", chunk, re.S):
        label = text(m.group(1))
        if label:
            pairs.append((label, m.group(2)))
    return pairs


# ----------------------------------------------------------- field parsers
def parse_periods(raw):
    """'Application periods' dd -> list of {who, semester, from, until} (day/month[/year])."""
    blocks = re.split(r"<hr\s*/?>", raw)
    out = []
    for b in blocks:
        t = text(b)
        if not t:
            continue
        who = ""
        mw = re.search(r"applicants from:(.*?)(?:For the|until|from \d|\d{1,2} [A-Z][a-z]+|$)", t, re.I)
        if mw:
            who = mw.group(1).strip(" :")
        sem = ""
        ms = re.search(r"For the ([\w\s-]+?semester|[\w\s-]+?trimester|[\w\s-]+?quarter|[\w\s-]+?intake)", t, re.I)
        if ms:
            sem = ms.group(1).strip()
        dates = re.findall(r"(from|until)\s+(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{4}))?", t, re.I)
        entry = {"who": who, "semester": sem, "text": t}
        # Ranges like "15 April - 31 May" or "1 Dec 2026 – 15 Jan 2027"
        rng = re.search(
            r"(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{4}))?\s*[-–]\s*(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{4}))?", t)
        if rng and not dates:
            d1, m1, y1, d2, m2, y2 = rng.groups()
            dates = [("from", d1, m1, y1 or ""), ("until", d2, m2, y2 or "")]
        for kind, d, mon, yr in dates:
            mi = MONTHS.get(mon.lower())
            if not mi:
                continue
            entry[kind.lower()] = {"d": int(d), "m": mi, **({"y": int(yr)} if yr else {})}
        out.append(entry)
    return out


def parse_lang(raw):
    """English/German skills dd -> {level, certs:{name:score}, text}."""
    t = text(raw)
    lvl = None
    m = re.search(r"<b>\s*([ABC][12])\s*</b>", raw) or re.search(r"\b([ABC][12])\b", t)
    if m:
        lvl = m.group(1)
    certs = {}
    last = None
    for li in re.findall(r"<li[^>]*>(.*?)</li>", raw, re.S):
        lt = text(li)
        mc = re.match(r"(.+?):\s*(.+)$", lt)
        if not mc:
            continue
        name, val = mc.group(1).strip(), mc.group(2).strip()
        if last and re.fullmatch(r"(reading|listening|speaking|writing|overall|total)", name, re.I):
            certs[last] += f" ({name} {val})" if "(" not in certs[last] else f"[{name} {val}]"
            certs[last] = certs[last].replace(")[", ", ").replace("]", ")")
            continue
        certs[name] = val
        last = name
    none = bool(re.search(r"no minimum|not required|none", t, re.I)) and not lvl
    return {"level": lvl, "certs": certs, "none": none, "html": clean_html(raw)}


def num_from_cert(certs, key, minimum=0):
    """First score for a certificate. TOEFL iBT also has a new 1–6 scale (since 2026);
    `minimum` skips those so the classic 0–120 score is used."""
    for k, v in certs.items():
        if key.lower() in k.lower():
            m = re.search(r"\d+(?:[.,]\d+)?", v)
            if m and float(m.group(0).replace(",", ".")) >= minimum:
                return float(m.group(0).replace(",", "."))
    return None


def parse_eur(t):
    m = re.search(r"(\d{1,3}(?:[.,]\d{3})+|\d+)\s*(?:EUR|€)", t)
    if not m:
        m = re.search(r"(?:EUR|€)\s*(\d{1,3}(?:[.,]\d{3})+|\d+)", t)
    if not m:
        return None
    return int(re.sub(r"[.,]", "", m.group(1)))


def parse_living(raw):
    items = []
    for label, val in re.findall(r"<strong>\s*([^<:]+?):?\s*</strong>\s*:?\s*([^<]+)", raw):
        amt = parse_eur(val + " EUR") if re.search(r"\d", val) else None
        if label.strip().lower().startswith("total"):
            continue
        items.append({"label": label.strip(" :"), "value": val.strip(), "eur": amt})
    t = text(raw)
    num = lambda s: int(re.sub(r"[.,]", "", s))
    total = low = None
    mt = re.search(r"Total[^0-9]{0,30}([\d.,]+)\s*(?:EUR|€)", t, re.I)
    if mt:
        total = num(mt.group(1))
    if not total:
        for a, b in re.findall(r"(\d[\d.,]*)\s*(?:EUR|€)?\s*(?:to|and|-|–)\s*(\d[\d.,]*)\s*(?:EUR|€)", t):
            lo, hi = num(a), num(b)
            if 400 <= lo < hi <= 3000:
                low, total = lo, hi
                break
    if not total:
        vals = [num(v) for v in re.findall(r"(\d[\d.,]*)\s*(?:EUR|€)", t)]
        vals = [v for v in vals if 600 <= v <= 2500]
        if vals and re.search(r"month", t, re.I):
            total = vals[0]
    if total and not 300 <= total <= 3000:
        total = low = None
    return {"items": items, "total": total, "low": low}


def contact(page):
    m = re.search(r'<div class="mb-5 c-contact">(.*?)</aside>', page, re.S)
    if not m:
        return {}
    c = m.group(1)
    res = {}
    mu = re.search(r'c-contact__location--title">\s*<a[^>]*href="([^"]+)"[^>]*>(.*?)</a>', c, re.S)
    if mu:
        res["uniUrl"], res["uniName"] = mu.group(1), text(mu.group(2))
    mf = re.findall(r'<p class="c-contact__location">(.*?)</p>', c, re.S)
    if mf:
        res["faculty"] = text(mf[0])
    ma = re.search(r'c-contact__address">(.*?)</p>', c, re.S)
    if ma:
        res["address"] = [x for x in (text(p) for p in re.split(r"<br\s*/?>", ma.group(1))) if x]
    me = re.search(r'href="mailto:([^"]+)"', c)
    if me:
        res["email"] = htmllib.unescape(me.group(1))
    mw = re.search(r'c-contact__url">\s*<a href="([^"]+)"', c)
    if mw:
        res["courseUrl"] = htmllib.unescape(mw.group(1))
    social = re.findall(r'c-social-list__item">\s*<a href="([^"]+)" aria-label="on ([^"]+)"', c)
    if social:
        res["social"] = [{"url": u, "name": n} for u, n in social]
    return res


def logo(page):
    m = re.search(r'c-profile__sidebar">.*?<img[^>]*?src="([^"]+)"', page, re.S)
    if m:
        return DAAD + "/" + m.group(1).lstrip("/.").lstrip("/")
    return None


def parse_detail(cid, page):
    d = {"id": cid, "sections": {}}
    for pid in ("overview", "costs", "registration", "services"):
        d["sections"][pid] = [{"label": l, "html": clean_html(v)} for l, v in dl_pairs(pane(page, pid))]

    reg = dict(dl_pairs(pane(page, "registration")))
    ov = dict(dl_pairs(pane(page, "overview")))
    costs = dict(dl_pairs(pane(page, "costs")))

    periods_raw = reg.get("Application periods") or ov.get("Application periods") or ""
    d["periods"] = parse_periods(periods_raw) if periods_raw else []
    d["periodsHtml"] = clean_html(periods_raw)
    for key, name in (("English language skills", "english"), ("German language skills", "german")):
        if key in reg:
            d[name] = parse_lang(reg[key])
    if "Academic admission requirements" in reg:
        d["academic"] = clean_html(reg["Academic admission requirements"])
    if "Submit application via" in reg:
        d["applyVia"] = clean_html(reg["Submit application via"])
        d["uniAssist"] = "uni-assist" in reg["Submit application via"].lower()
    if "Language requirements exemptions" in reg:
        d["langExempt"] = clean_html(reg["Language requirements exemptions"])
    if "Costs of living" in costs:
        d["living"] = parse_living(costs["Costs of living"])
    sc = costs.get("Semester contribution")
    if sc:
        d["semesterFee"] = parse_eur(text(sc))
    tf = next((v for k, v in costs.items() if k.lower().startswith("tuition fees")), None)
    if tf:
        d["tuitionText"] = text(tf)
        d["tuitionEur"] = parse_eur(text(tf))
    mc = re.search(r'data-cords="([-\d.]+)x([-\d.]+)"', page)
    if mc:
        d["geo"] = [float(mc.group(1)), float(mc.group(2))]
    d["contact"] = contact(page)
    d["logo"] = logo(page)
    d["daadUrl"] = DAAD_DETAIL.format(cid)
    d["gre"] = bool(re.search(r"\bGRE\b", text(reg.get("Academic admission requirements", ""))))
    d["gmat"] = bool(re.search(r"\bGMAT\b", text(reg.get("Academic admission requirements", ""))))
    return d


# --------------------------------------------------------------------- main
def main():
    lst = json.loads((CACHE / "list.json").read_text(encoding="utf-8"))
    groups = {int(k): v for k, v in lst["groups"].items()}
    fos = {int(k): v for k, v in lst["fos"].items()}
    fos_map = lst["fosMap"]
    (OUT / "details").mkdir(parents=True, exist_ok=True)

    index = []
    missing = 0
    for c in lst["courses"]:
        cid = c["id"]
        f = CACHE / "detail" / f"{cid}.html"
        det = parse_detail(cid, f.read_text(encoding="utf-8")) if f.exists() else None
        if det is None:
            missing += 1
        img = c.get("image")
        img = (DAAD + img) if img else None
        langs = c.get("languages") or []
        row = {
            "id": cid,
            "n": c["courseName"],
            "u": c["academy"],
            "c": c["city"],
            "d": c["courseType"],  # 1 bachelor, 2 master
            "l": langs,
            "s": c.get("subject") or "",
            "g": groups.get(cid, []),
            "f": fos.get(cid, []),
            "b": c.get("beginning") or "",
            "dur": c.get("programmeDuration") or "",
            "fee": c.get("tuitionFees") or "",
            "dl": c.get("applicationDeadline") or "",
            "img": img,
            "online": bool(c.get("isCompleteOnlinePossible")),
        }
        if det:
            row["p"] = [{k: v for k, v in p.items() if k in ("who", "semester", "from", "until")} for p in det["periods"]]
            if det.get("geo"):
                row["geo"] = det["geo"]
            en = det.get("english") or {}
            de = det.get("german") or {}
            row["en"] = en.get("level")
            row["de"] = None if de.get("none") else de.get("level")
            row["ielts"] = num_from_cert(en.get("certs", {}), "IELTS")
            row["toefl"] = num_from_cert(en.get("certs", {}), "TOEFL", minimum=30)
            row["gre"] = det["gre"]
            row["ua"] = det.get("uniAssist", False)
            row["eur"] = det.get("tuitionEur")
            row["live"] = (det.get("living") or {}).get("total")
            row["liveLo"] = (det.get("living") or {}).get("low")
            det.update({k: row[k] for k in ("n", "u", "c", "d", "l", "s", "g", "f", "b", "dur", "fee", "dl", "img", "online")})
            (OUT / "details" / f"{cid}.js").write_text(
                "window.__studybahnDetail(" + json.dumps(det, ensure_ascii=False, separators=(",", ":")) + ");",
                encoding="utf-8",
            )
        index.append({k: v for k, v in row.items() if v not in (None, "", [], False)})

    meta = {
        "built": date.today().isoformat(),
        "source": "DAAD International Programmes in Germany",
        "groups": SUBJECT_GROUPS,
        "fos": {f["id"]: {"name": f["name"], "group": f["subjectGroup"]} for f in fos_map},
    }
    (OUT / "programmes.js").write_text(
        "window.STUDYBAHN=" + json.dumps({"meta": meta, "programmes": index}, ensure_ascii=False, separators=(",", ":")) + ";",
        encoding="utf-8",
    )
    print(f"Wrote {len(index)} programmes ({missing} without detail page).")


if __name__ == "__main__":
    main()
