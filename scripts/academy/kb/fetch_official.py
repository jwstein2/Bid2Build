#!/usr/bin/env python3
"""
Fetch the official, lawfully reusable text behind the Academy knowledge engine's seed and write a snapshot.

  python3 -I scripts/academy/kb/fetch_official.py           # writes src/lib/academy/kb/seed/official-snapshot.json

What it reads (all public, no login, no paywall, no scraping past access controls):
  * eCFR (https://www.ecfr.gov) versioner API: U.S. federal regulations. Works of the U.S. Government are public
    domain (17 U.S.C. 105), so full text is stored with its exact citation.
  * Minnesota Office of the Revisor (https://www.revisor.mn.gov/rules/...): official Minnesota Rules text. Stored
    as short per-subpart excerpts of the state's own amendments (not the incorporated ICC model code).
  * Minnesota DLI pages: quoted only as verification evidence (effective dates), never as lesson text.

Every record carries the URL, the fetch time and a SHA-256 of the normalized text, so a later run can tell whether
the official text changed (scripts/academy/kb/gen-seed.ts turns the snapshot into SQL, and the monthly monitor in
/api/cron/academy-kb compares hashes).
"""
import hashlib
import html
import json
import os
import re
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
OUT = os.path.join(ROOT, "src", "lib", "academy", "kb", "seed", "official-snapshot.json")
UA = "Built2Bid-Academy-source-check/1.0"

# ---------------------------------------------------------------------------------------------------------------
# What to fetch. trades use the canonical slugs in src/lib/trades/data.ts; topics feed the terminology search.
# paragraphs: top-level paragraph letters to keep (None = whole section, split by top-level paragraph if long).
# ---------------------------------------------------------------------------------------------------------------
ALL = []  # [] = applies to every trade
EXTERIOR = ["roofing", "siding", "gutters", "windows-doors", "painting", "exterior-remodeling", "general-contracting"]
STRUCT = ["decks", "framing", "additions", "garages", "general-contracting", "exterior-remodeling", "interior-remodeling", "basements"]

ECFR = [
    # title, part, section, paragraphs, trades, topics
    (29, "1926", "1926.20", None, ALL, ["safety program", "inspections", "competent person"]),
    (29, "1926", "1926.21", None, ALL, ["training", "safety training"]),
    (29, "1926", "1926.95", ["a"], ALL, ["ppe", "personal protective equipment"]),
    (29, "1926", "1926.100", None, ALL, ["hard hat", "head protection", "ppe"]),
    (29, "1926", "1926.102", ["a"], ALL, ["eye protection", "face protection", "ppe"]),
    (29, "1926", "1926.404", ["b"], ALL, ["gfci", "ground fault", "temporary power", "extension cords"]),
    (29, "1926", "1926.451", ["a", "g"], ["painting", "siding", "masonry", "roofing", "general-contracting", "pressure-washing", "soft-washing"], ["scaffold", "scaffolding", "fall protection"]),
    (29, "1926", "1926.501", None, ALL, ["fall protection", "roof edge", "guardrail", "residential construction", "low-slope roof", "steep roof", "holes", "excavation edge"]),
    (29, "1926", "1926.502", ["b", "d", "k"], ALL, ["guardrail", "guardrail height", "personal fall arrest", "harness", "anchorage", "fall protection plan"]),
    (29, "1926", "1926.503", None, ALL, ["fall protection training", "training"]),
    (29, "1926", "1926.651", None, ["excavation", "foundations", "concrete", "plumbing", "landscaping", "basements", "general-contracting", "pole-barns"], ["excavation", "trench", "utilities", "call before you dig", "competent person", "spoil pile"]),
    (29, "1926", "1926.652", ["a"], ["excavation", "foundations", "concrete", "plumbing", "basements", "general-contracting"], ["trench protection", "shoring", "sloping", "trench box", "excavation"]),
    (29, "1926", "1926.850", None, ["demolition", "interior-remodeling", "general-contracting", "commercial-remodeling"], ["demolition", "engineering survey", "utilities shutoff"]),
    (29, "1926", "1926.1052", None, ALL, ["stairways", "construction stairs", "stair riser", "stair tread", "stair rail", "handrail"]),
    (29, "1926", "1926.1053", ["a", "b"], ALL, ["ladders", "ladder", "extension ladder", "ladder angle", "ladder side rails"]),
    (29, "1926", "1926.1060", None, ALL, ["ladder training", "stairway training", "training"]),
    (29, "1926", "1926.62", ["a"], ["painting", "interior-remodeling", "exterior-remodeling", "demolition", "windows-doors", "general-contracting"], ["lead", "lead exposure"]),
    (29, "1926", "1926.1101", ["a"], ["demolition", "roofing", "flooring", "insulation", "interior-remodeling", "general-contracting"], ["asbestos"]),
    (29, "1926", "1926.1153", ["a", "c"], ["concrete", "masonry", "tile", "asphalt-paving", "foundations", "demolition", "cabinets-countertops", "general-contracting"], ["silica", "concrete cutting", "dust control", "respirator"]),
    (29, "1904", "1904.1", None, ALL, ["recordkeeping", "osha 300 log", "small employer"]),
    (29, "1904", "1904.39", ["a"], ALL, ["reporting", "fatality", "injury reporting"]),
    (40, "745", "745.82", None, ["painting", "interior-remodeling", "exterior-remodeling", "windows-doors", "siding", "kitchens", "bathrooms", "general-contracting", "handyman"], ["lead paint", "rrp", "pre-1978", "renovation"]),
    (40, "745", "745.84", ["a"], ["painting", "interior-remodeling", "exterior-remodeling", "windows-doors", "siding", "general-contracting", "handyman"], ["lead paint", "renovate right", "pre-renovation education", "rrp"]),
    (40, "745", "745.85", ["a"], ["painting", "interior-remodeling", "exterior-remodeling", "windows-doors", "siding", "general-contracting", "handyman"], ["lead paint", "lead-safe work practices", "containment", "rrp"]),
    (40, "745", "745.89", ["a"], ["painting", "interior-remodeling", "exterior-remodeling", "windows-doors", "siding", "general-contracting", "handyman"], ["lead firm certification", "rrp certification", "lead paint"]),
    (49, "391", "391.11", None, ["excavation", "concrete", "landscaping", "tree-removal", "demolition", "asphalt-paving", "general-contracting"], ["dot", "cdl", "driver qualification", "commercial driver"]),
    (49, "396", "396.17", ["a"], ["excavation", "concrete", "landscaping", "tree-removal", "demolition", "asphalt-paving", "general-contracting"], ["dot", "vehicle inspection", "annual inspection", "commercial vehicle"]),
    (49, "382", "382.103", None, ["excavation", "concrete", "landscaping", "tree-removal", "demolition", "asphalt-paving", "general-contracting"], ["dot", "drug testing", "alcohol testing", "cdl"]),
]

# 29 CFR part 1952 subpart A: OSHA-approved State Plans covering private-sector employers (verification evidence).
STATE_PLANS = {
    "1952.1": "SC", "1952.2": "OR", "1952.3": "UT", "1952.4": "WA", "1952.5": "NC", "1952.6": "IA", "1952.7": "CA",
    "1952.8": "MN", "1952.9": "MD", "1952.10": "TN", "1952.11": "KY", "1952.12": "AK", "1952.13": "MI", "1952.14": "VT",
    "1952.15": "NV", "1952.16": "HI", "1952.17": "IN", "1952.18": "WY", "1952.19": "AZ", "1952.20": "NM", "1952.21": "VA",
}

# Minnesota Rules parts (state amendments and adoption scope). trades/topics as above.
MN_RULES = [
    ("1300.0120", ALL, ["permits", "permit required", "work exempt from permit", "building permit"]),
    ("1305.0011", ["commercial-remodeling", "general-contracting"], ["ibc", "commercial building code", "adoption"]),
    ("1309.0010", ALL, ["irc", "residential code", "adoption", "minnesota residential code"]),
    ("1309.0311", STRUCT + ["decks"], ["stairways", "stairs", "stair width", "headroom", "exterior door landing", "deck stairs"]),
    ("1309.0312", STRUCT + ["decks", "windows-doors"], ["guards", "guardrail", "window fall protection", "deck guard"]),
    ("1309.0403", ["concrete", "foundations", "decks", "additions", "garages", "general-contracting", "pole-barns"], ["footings", "frost depth", "frost protection"]),
    ("1309.0507", ["decks", "general-contracting"], ["decks", "deck footings", "deck ledger", "deck frost"]),
    ("1309.0703", ["siding", "exterior-remodeling", "general-contracting"], ["siding", "exterior covering", "water-resistive barrier"]),
    ("1309.0903", ["roofing", "general-contracting"], ["roof flashing", "weather protection", "roofing"]),
    ("1309.0905", ["roofing", "general-contracting"], ["roof coverings", "ice barrier", "underlayment", "shingles", "roofing"]),
    ("1315.0200", ["electrical", "general-contracting"], ["nec", "electrical code", "adoption", "minnesota electrical code"]),
    ("1322.0010", ["insulation", "general-contracting", "windows-doors", "hvac"], ["energy code", "iecc", "residential energy", "adoption"]),
    ("1346.0050", ["hvac", "general-contracting"], ["mechanical code", "imc", "adoption"]),
]

DLI_PAGES = [
    ("mn-dli-building-code", "https://www.dli.mn.gov/business/codes-and-laws/2020-minnesota-state-building-codes",
     ["The 2020 Minnesota State Building Code is effective March 31, 2020", "not enforceable by municipalities unless it is adopted by local ordinance"]),
    ("mn-dli-electrical", "https://www.dli.mn.gov/business/electrical-contractors",
     ["adopted the 2026 National Electrical Code (NEC) with an effective date of Aug. 17, 2026", "Electrical permits filed before Aug. 17, 2026, must comply with the 2023 NEC"]),
]


def get(url, compressed=False):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "gzip" if compressed else "identity"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=45) as r:
                data = r.read()
                if r.headers.get("Content-Encoding") == "gzip":
                    import gzip
                    data = gzip.decompress(data)
                return r.status, data.decode("utf-8", "replace")
        except Exception as e:  # noqa: BLE001
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)
    raise RuntimeError("unreachable")


def norm(s):
    return re.sub(r"\s+", " ", s).strip()


def sha(s):
    return hashlib.sha256(norm(s).encode("utf-8")).hexdigest()


def ecfr_date():
    _, body = get("https://www.ecfr.gov/api/versioner/v1/titles.json")
    return {t["number"]: t["up_to_date_as_of"] for t in json.loads(body)["titles"]}


def xml_text(el):
    parts = []
    if el.text:
        parts.append(el.text)
    for c in el:
        if c.tag == "FR":
            parts.append(" " + (c.text or "") + " ")
        else:
            parts.append(xml_text(c))
        if c.tail:
            parts.append(c.tail)
    return "".join(parts)


def fetch_ecfr(title, part, section, date):
    url = f"https://www.ecfr.gov/api/versioner/v1/full/{date}/title-{title}.xml?part={part}&section={section}"
    status, body = get(url, compressed=True)
    root = ET.fromstring(body.encode("utf-8"))
    head = norm(xml_text(root.find("HEAD")))
    paras = []
    for el in root.iter():
        # Appendices and notes that follow a section are not part of it.
        if el.tag in ("APPENDIX",) or (el.tag.startswith("DIV") and el is not root and (el.get("TYPE") or "").upper() == "APPENDIX"):
            break
        if el.tag == "HD1" and re.match(r"^\s*Appendix", xml_text(el) or "", flags=re.I):
            break
        if el.tag in ("P", "FP"):
            t = norm(xml_text(el))
            if t:
                paras.append(t)
        elif el.tag == "GPOTABLE":
            paras.append("[Table: see the official source for this table.]")
    return url, head, paras


def split_top(paras):
    """Group paragraphs by top-level letter: (a), (b) ... Paragraphs before (a) go to an intro group."""
    groups, cur, key = [], [], "_"
    for p in paras:
        m = re.match(r"^\(([a-z]{1,2})\)", p)
        roman = bool(re.match(r"^\((i|ii|iii|iv|v|vi|vii|viii|ix|x)\)", p))
        # "(i)", "(v)" and "(x)" are letters when they follow "(h)", "(u)" and "(w)"; otherwise roman numerals.
        next_letter = m and len(m.group(1)) == 1 and key != "_" and len(key) == 1 and ord(m.group(1)) == ord(key) + 1
        if m and (len(m.group(1)) == 1 or m.group(1) in ("aa", "bb")) and (not roman or next_letter):
            if cur:
                groups.append((key, cur))
            key, cur = m.group(1), [p]
        else:
            cur.append(p)
    if cur:
        groups.append((key, cur))
    seen, out = set(), []
    for k, ps in groups:  # a later "(a)" (appendix numbering) never replaces the section's own (a)
        if k in seen:
            break
        seen.add(k)
        out.append((k, ps))
    return out


def revisor_text(page_html):
    m = re.search(r'<div[^>]*id="rule"[^>]*>(.*?)<div[^>]*id="(?:footer|history)', page_html, flags=re.S) or re.search(r'<div[^>]*id="rule"[^>]*>(.*)', page_html, flags=re.S)
    t = m.group(1) if m else page_html
    t = re.sub(r"<script.*?</script>|<style.*?</style>", "", t, flags=re.S)
    t = re.sub(r"<(br|/p|/div|/h\d)[^>]*>", "\n", t)
    t = html.unescape(re.sub(r"<[^>]+>", " ", t))
    lines = [norm(x) for x in t.split("\n")]
    return "\n".join(x for x in lines if x)


def fetch_mn(part):
    url = f"https://www.revisor.mn.gov/rules/{part}/"
    status, body = get(url)
    text = revisor_text(body)
    flat = norm(text)
    i = flat.find(part + " ", flat.find("Version List " + part) + 1 if ("Version List " + part) in flat else 0)
    flat = flat[i:] if i >= 0 else flat
    end = re.search(r"Statutory Authority:", flat)
    history = ""
    if end:
        hist = re.search(r"History:(.*?)(Published Electronically:\s*[A-Za-z]+ \d{1,2}, \d{4})", flat[end.start():])
        history = norm(hist.group(1)) + " | " + hist.group(2) if hist else ""
        flat = flat[: end.start()]
    flat = re.sub(r"^" + re.escape(part) + r"\s+\[Repealed[^\]]*\]\s*(?=" + re.escape(part) + r")", "", flat)
    m = re.match(r"^" + re.escape(part) + r"\s+([A-Z0-9][A-Z0-9 ,;:()'&/\-]*?(?:\.[A-Z0-9]+)*)\.\s", flat)
    heading = norm(m.group(1)) if m else ""
    body_txt = flat[m.end():].strip() if m else flat
    body_txt = re.sub(r"^[\s§\u00a0]+", "", body_txt)
    subs = re.split(r"\s*§\s*(?=Subp(?:art|\.)\s*\d+[a-z]?\.)", body_txt)
    subparts = []
    for s in subs:
        s = s.strip()
        if not s:
            continue
        s = re.sub(r"^[\s§\u00a0]+", "", s)
        mm = re.match(r"^Subp(?:art|\.)\s*(\d+[a-z]?)\.\s*(.*?)\.\s(.*)$", s, flags=re.S)
        if mm:
            subparts.append({"subp": mm.group(1), "title": norm(mm.group(2)), "text": norm(s.replace(" § ", "\n"))})
        else:
            subparts.append({"subp": None, "title": heading, "text": norm(s.replace(" § ", "\n"))})
    return {"url": url, "status": status, "heading": heading, "history": history, "subparts": subparts, "hash": sha(body_txt)}


def main():
    fetched_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    dates = ecfr_date()
    out = {"fetched_at": fetched_at, "ecfr_dates": {str(k): dates[k] for k in (29, 40, 49)}, "ecfr": [], "state_plans": [], "mn": [], "evidence": []}
    for title, part, section, keep, trades, topics in ECFR:
        date = dates[title]
        url, head, paras = fetch_ecfr(title, part, section, date)
        full = "\n".join(paras)
        groups = split_top(paras)
        long = len(full) > 3500 or keep
        rows = []
        if long:
            for key, ps in groups:
                if keep and key not in keep:
                    continue
                if key == "_":
                    continue
                rows.append({"paragraph": key, "text": "\n".join(ps), "hash": sha("\n".join(ps))})
        else:
            rows.append({"paragraph": None, "text": full, "hash": sha(full)})
        out["ecfr"].append({"title": title, "part": part, "section": section, "head": head, "url": url, "as_of": date,
                            "read_url": f"https://www.ecfr.gov/current/title-{title}/section-{section}", "trades": sorted(set(trades)), "topics": topics,
                            "section_hash": sha(full), "rows": rows})
        print(f"eCFR {title} CFR {section}: {len(rows)} row(s)", file=sys.stderr)
    for section, state in STATE_PLANS.items():
        url, head, paras = fetch_ecfr(29, "1952", section, dates[29])
        full = "\n".join(paras)
        out["state_plans"].append({"section": section, "state": state, "head": head, "url": url, "as_of": dates[29],
                                   "read_url": f"https://www.ecfr.gov/current/title-29/section-{section}", "evidence": full[:600], "hash": sha(full)})
    for part, trades, topics in MN_RULES:
        r = fetch_mn(part)
        r.update({"part": part, "trades": sorted(set(trades)), "topics": topics})
        out["mn"].append(r)
        print(f"MN {part}: {len(r['subparts'])} subpart(s) {r['heading'][:60]}", file=sys.stderr)
    for key, url, quotes in DLI_PAGES:
        status, body = get(url)
        flat = norm(html.unescape(re.sub(r"<[^>]+>", " ", re.sub(r"<script.*?</script>|<style.*?</style>", "", body, flags=re.S))))
        found = [q for q in quotes if q in flat]
        missing = [q for q in quotes if q not in flat]
        if missing:
            print(f"WARNING {key}: quote not found on page: {missing}", file=sys.stderr)
        out["evidence"].append({"key": key, "url": url, "status": status, "quotes": found, "missing": missing})
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1, ensure_ascii=False)
        f.write("\n")
    print(f"wrote {OUT}", file=sys.stderr)


if __name__ == "__main__":
    main()
