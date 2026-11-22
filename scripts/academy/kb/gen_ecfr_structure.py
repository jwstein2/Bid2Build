#!/usr/bin/env python3
"""
Codebook hierarchy snapshot from the official eCFR versioner API (public domain U.S. regulations).

Writes src/lib/academy/kb/seed/ecfr-structure.json: Title -> Chapter -> Part -> Subpart -> Section headings (no
regulatory text) for the contractor-relevant parts, plus each part's latest amendment date. The Academy "Browse the
codebook" page and the citation autocomplete read it. Re-run any time; the monthly source monitor flags changes.

  python3 scripts/academy/kb/gen_ecfr_structure.py [YYYY-MM-DD]
"""
import gzip
import json
import os
import sys
import time
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
OUT = os.path.join(ROOT, "src", "lib", "academy", "kb", "seed", "ecfr-structure.json")
INDEX = os.path.join(ROOT, "public", "academy-codes", "federal-sections.json")
UA = "Built2Bid-Academy-source-check/1.0"
API = "https://www.ecfr.gov/api/versioner/v1"

# (title, part, why it matters to contractors)
PARTS = [
    (29, "1926", "OSHA safety and health rules for construction work"),
    (29, "1904", "OSHA injury and illness recordkeeping and reporting"),
    (40, "745", "EPA lead-based paint rules, including the Renovation, Repair and Painting (RRP) rule"),
    (49, "382", "DOT drug and alcohol testing for CDL drivers"),
    (49, "390", "FMCSA general rules: who counts as a commercial motor vehicle operator"),
    (49, "391", "FMCSA driver qualifications (medical card, driver file)"),
    (49, "392", "FMCSA driving rules"),
    (49, "393", "FMCSA parts and accessories, including cargo securement"),
    (49, "395", "FMCSA hours of service"),
    (49, "396", "FMCSA inspection, repair and maintenance"),
]


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "gzip"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
                if r.headers.get("Content-Encoding") == "gzip":
                    data = gzip.decompress(data)
                return json.loads(data)
        except Exception:  # noqa: BLE001
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)


def find(node, kind, ident, chain):
    if node.get("type") == kind and node.get("identifier") == ident:
        return node, chain
    for c in node.get("children") or []:
        hit = find(c, kind, ident, chain + [node])
        if hit:
            return hit
    return None


def simplify(node):
    kind = node.get("type")
    if kind == "section":
        return {"t": "section", "id": node["identifier"], "label": node.get("label_description") or "", "reserved": bool(node.get("reserved"))}
    if kind == "appendix":
        return {"t": "appendix", "id": node.get("identifier") or "", "label": node.get("label") or ""}
    kids = [simplify(c) for c in node.get("children") or []]
    kids = [k for k in kids if k]
    return {"t": kind, "id": node.get("identifier") or "", "label": node.get("label_level") or "", "desc": node.get("label_description") or "", "children": kids}


def main():
    titles = {t["number"]: t for t in get(f"{API}/titles.json")["titles"]}
    out = {"generated": time.strftime("%Y-%m-%d"), "source": "https://www.ecfr.gov/developers/documentation/api/v1", "parts": []}
    by_title = {}
    for title, part, why in PARTS:
        date = sys.argv[1] if len(sys.argv) > 1 else titles[title]["up_to_date_as_of"]
        if title not in by_title:
            by_title[title] = get(f"{API}/structure/{date}/title-{title}.json")
        found = find(by_title[title], "part", part, [])
        if not found:
            raise SystemExit(f"part {title} CFR {part} not found")
        node, chain = found
        versions = get(f"{API}/versions/title-{title}.json?part={part}")["content_versions"]
        last = max((v["amendment_date"] for v in versions), default=None)
        out["parts"].append({
            "title": title, "part": part, "why": why, "as_of": date, "last_amended": last,
            "path": [{"t": n["type"], "label": n.get("label_level") or "", "desc": n.get("label_description") or ""} for n in chain if n["type"] in ("title", "chapter", "subchapter")],
            "node": simplify(node),
        })
        print(f"{title} CFR {part}: as of {date}, last amended {last}")
    with open(OUT, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"wrote {OUT} ({os.path.getsize(OUT)} bytes)")
    # Flat index for the citation-aware autocomplete (served as a static file, fetched on first focus).
    flat = []
    def walk(n, title):
        if n["t"] == "section" and not n.get("reserved") and n["label"]:
            flat.append([f"{title} CFR {n['id']}", n["label"].rstrip(".")])
        for c in n.get("children") or []:
            walk(c, title)
    for p_ in out["parts"]:
        walk(p_["node"], p_["title"])
    os.makedirs(os.path.dirname(INDEX), exist_ok=True)
    with open(INDEX, "w") as f:
        json.dump({"generated": out["generated"], "sections": flat}, f, separators=(",", ":"))
    print(f"wrote {INDEX} ({len(flat)} sections, {os.path.getsize(INDEX)} bytes)")


if __name__ == "__main__":
    main()
