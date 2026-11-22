#!/usr/bin/env python3
"""
Fetches the Minnesota Department of Labor and Industry State Building Code jurisdiction directory
(https://workplace.doli.state.mn.us/jurisdiction/), one county at a time, and writes
src/lib/academy/kb/seed/mn-jurisdictions.json. Official government data; only office-level fields are kept
(no inspector names). Run: python3 scripts/academy/kb/fetch_mn_jurisdictions.py
"""
import html, http.cookiejar, json, re, sys, time, urllib.parse, urllib.request
from datetime import datetime, timezone

URL = "https://workplace.doli.state.mn.us/jurisdiction/"
UA = {"User-Agent": "Built2Bid-Academy-SourceFetch/1.0 (+https://built2bid.org/academy)"}
OUT = "src/lib/academy/kb/seed/mn-jurisdictions.json"


def text(h):
    t = re.sub(r"<[^>]+>", " | ", h)
    return html.unescape(re.sub(r"(\s*\|\s*)+", " | ", t))


def yesno(block, label):
    m = re.search(re.escape(label) + r"\s*\|\s*(YES|NO)\b", block)
    return m.group(1) if m else None


def field(block, label, nxt):
    m = re.search(re.escape(label) + r"\s*\|\s*(.*?)\s*\|\s*" + nxt, block)
    v = (m.group(1).strip(" |") if m else "").strip()
    return None if v in ("", "N/A") else v


def main():
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    page = op.open(urllib.request.Request(URL, headers=UA), timeout=60).read().decode()
    counties = re.findall(r'<option value="([^"]+)">', page.split('id="i_countyDdl"')[1].split("</select>")[0])
    out = []
    for c in counties:
        hid = lambda n: re.search(r'id="%s" value="([^"]*)"' % n, page).group(1)
        data = {"__EVENTTARGET": "", "__EVENTARGUMENT": "", "__LASTFOCUS": "", "__VIEWSTATE": hid("__VIEWSTATE"),
                "__VIEWSTATEGENERATOR": hid("__VIEWSTATEGENERATOR"), "__EVENTVALIDATION": hid("__EVENTVALIDATION"),
                "ctl00$i$cityDdl": "", "ctl00$i$townshipDdl": "", "ctl00$i$countyDdl": c, "ctl00$i$searchActionBtn": "Search", "ctl00$i$pageSizeDdl": "4000"}
        for attempt in range(4):
            try:
                r = op.open(urllib.request.Request(URL, data=urllib.parse.urlencode(data).encode(), headers=UA), timeout=90).read().decode()
                break
            except Exception:  # noqa: BLE001
                if attempt == 3:
                    raise
                time.sleep(2 ** attempt)
        t = text(r)
        blocks = t.split("| CITY: |")[1:]
        for b in blocks:
            b = "CITY: |" + b
            rec = {
                "city": field(b, "CITY:", "TOWNSHIP:"),
                "township": field(b, "TOWNSHIP:", "COUNTY:"),
                "county": field(b, "COUNTY:", "BUILDING OFFICIAL:"),
                "bo_phone": field(b, "B.O. PHONE:", "BUILDING CODES"),
                "adopted": yesno(b, "HAS ADOPTED THE BUILDING CODE:"),
                "opt_1306_2": yesno(b, "1306 SUB PART 2:"),
                "opt_1306_3": yesno(b, "1306 SUB PART 3:"),
                "accessibility": field(b, "ACCESSIBILITY ENFORCED:", "BLEACHER"),
                "electrical": field(b, "ELECTRICAL | AUTHORITY:", r"(?:\|\s*)*INSP\. NAME:"),
                "plumbing_inspects": yesno(b, "MUNICIPALITY INSPECTS NON-STATE PROJECTS:"),
            }
            if rec["county"]:
                out.append(rec)
        print(c, len(blocks), file=sys.stderr)
        time.sleep(0.5)
    seen, uniq = set(), []
    for r in out:
        k = (r["city"], r["township"], r["county"])
        if k not in seen:
            seen.add(k)
            uniq.append(r)
    json.dump({"source": URL, "fetched_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "records": uniq}, open(OUT, "w"), indent=1)
    print(f"wrote {OUT}: {len(uniq)} jurisdictions", file=sys.stderr)


if __name__ == "__main__":
    main()
