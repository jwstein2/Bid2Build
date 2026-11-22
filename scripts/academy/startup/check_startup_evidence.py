#!/usr/bin/env python3
"""
Re-checks the researched "Start Your Contracting Business" state files against the official pages.

Input:  a folder of <ST>.json research files (shape in docs/academy/startup/README.md).
Output: src/lib/academy/startup/data/<ST>.json (one per state + DC) and a printed summary.

Every fact (general steps, credential categories, extra evidence, "other" credentials) carries an official url and a
quote. The page is fetched again (HTML -> text, PDF -> pdftotext) and the quote must appear word for word (whitespace,
quote marks and dashes normalized; "..." joins exact fragments). Matches are "verified" with the page hash; anything
else is "pending_review" with the reason. A number (dollars, years, hours, percents) written in our own words must
also appear in one of that fact's verified quotes, or the fact is held back as pending.

Run: python3 -I scripts/academy/startup/check_startup_evidence.py <research_dir> [cache_dir]
"""
import hashlib, html, json, os, re, subprocess, sys, tempfile, time
from urllib.parse import urljoin, urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
OUT_DIR = os.path.join(ROOT, "src/lib/academy/startup/data")
SRC = sys.argv[1]
CACHE = sys.argv[2] if len(sys.argv) > 2 else os.path.join(tempfile.gettempdir(), "b2b-startup-evidence")
os.makedirs(CACHE, exist_ok=True)
os.makedirs(OUT_DIR, exist_ok=True)

STATES = set("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split())
GENERAL = ["entity", "state_tax", "unemployment", "workers_comp", "local"]
CATEGORIES = ["residential_building", "commercial_building", "electrical", "plumbing", "mechanical", "roofing", "pesticide", "asbestos", "lead_rrp"]
STATUSES = {"state_license", "state_registration", "threshold", "no_state_license", "local_only", "unknown"}
TRADES = set("roofing siding decks concrete kitchens bathrooms interior-remodeling exterior-remodeling drywall painting electrical plumbing hvac flooring tile framing finish-carpentry cabinets-countertops windows-doors insulation gutters fencing landscaping pressure-washing soft-washing cleaning excavation foundations masonry asphalt-paving demolition basements additions garages pole-barns commercial-remodeling general-contracting handyman tree-removal tree-trimming pest-control".split())
BLOCKED_HOSTS = {"codes.findlaw.com", "law.justia.com", "www.nolo.com", "www.legalzoom.com", "casetext.com", "www.law.cornell.edu"}


def official(url):
    try:
        u = urlparse(url)
    except Exception:
        return False
    h = (u.hostname or "").lower()
    if u.scheme != "https" or h in BLOCKED_HOSTS:
        return False
    if h.endswith(".gov") or h.endswith(".us") or h.endswith(".mil"):
        return True
    # State legislature / admin code / agency hosts that are not on .gov (state-run, listed by hand).
    return h in EXTRA_OFFICIAL


EXTRA_OFFICIAL = {
    "www.revisor.mn.gov", "codes.ohio.gov", "www.pacodeandbulletin.gov", "www.legislature.mi.gov", "le.utah.gov", "www.azleg.gov",
    "apps.azsos.gov", "www.ilga.gov", "ilga.gov", "www.flrules.org", "flrules.org", "www.leg.state.fl.us", "www.flsenate.gov",
    "www.myfloridalicense.com", "www.cslb.ca.gov", "www.tdlr.texas.gov", "www.sunbiz.org", "sunbiz.org", "dos.fl.gov", "floridarevenue.com",
    "www.nclbgc.org", "nclbgc.org", "www.ncbeec.org", "www.lslbc.louisiana.gov", "www.msboc.us", "genconbd.alabama.gov", "www.nvcontractorsboard.com",
    "www.cslb.ca.gov", "www.leginfo.legislature.ca.gov", "leginfo.legislature.ca.gov", "malegislature.gov", "www.mass.gov", "www.ct.gov", "portal.ct.gov",
    "www.ny.gov", "www.dos.ny.gov", "dos.ny.gov", "www.nysenate.gov", "www.nj.gov", "www.njconsumeraffairs.gov", "www.pa.gov", "www.attorneygeneral.gov",
    "www.legis.state.pa.us", "www.palegis.us", "www.dllr.state.md.us", "labor.maryland.gov", "mgaleg.maryland.gov", "www.dpor.virginia.gov", "law.lis.virginia.gov",
    "www.scc.virginia.gov", "lis.virginia.gov", "www.sos.wa.gov", "lni.wa.gov", "app.leg.wa.gov", "www.oregon.gov", "oregon.public.law", "www.oregonlegislature.gov",
    "www.colorado.gov", "dora.colorado.gov", "leg.colorado.gov", "www.sos.state.co.us", "www.azroc.gov", "roc.az.gov", "www.utah.gov", "dopl.utah.gov",
    "www.idaho.gov", "dopl.idaho.gov", "legislature.idaho.gov", "www.sos.state.oh.us", "www.ohiosos.gov", "com.ohio.gov", "www.iga.in.gov", "iga.in.gov",
    "www.in.gov", "www.michigan.gov", "dsps.wi.gov", "docs.legis.wisconsin.gov", "www.wdfi.org", "www.iowa.gov", "www.legis.iowa.gov", "dial.iowa.gov",
    "www.ksrevisor.org", "www.sos.ks.gov", "sos.ks.gov", "www.kslegislature.gov", "revisor.mo.gov", "www.sos.mo.gov", "pr.mo.gov", "www.nebraska.gov",
    "nebraskalegislature.gov", "www.dol.nebraska.gov", "www.sdlegislature.gov", "sdlegislature.gov", "sdsos.gov", "www.nd.gov", "www.ndlegis.gov", "sos.nd.gov",
    "mtrules.org", "leg.mt.gov", "sosmt.gov", "boc.mt.gov", "wyoleg.gov", "sos.wyo.gov", "wyomingbusiness.org", "www.nmlegis.gov", "www.rld.nm.gov",
    "www.sos.nm.gov", "www.tn.gov", "sos.tn.gov", "www.capitol.tn.gov", "www.kentucky.gov", "apps.legislature.ky.gov", "legislature.ky.gov", "www.sos.ky.gov",
    "www.wvlegislature.gov", "wvlabor.com", "sos.wv.gov", "www.sos.ga.gov", "sos.ga.gov", "www.legis.ga.gov", "www.scstatehouse.gov", "llr.sc.gov", "www.sos.sc.gov",
    "www.alabama.gov", "alison.legislature.state.al.us", "www.sos.alabama.gov", "sos.alabama.gov", "www.sos.ms.gov", "www.legislature.ms.gov", "www.sos.la.gov",
    "legis.la.gov", "www.legis.la.gov", "www.sos.arkansas.gov", "www.arkleg.state.ar.us", "arkleg.state.ar.us", "aclb.arkansas.gov", "www.labor.arkansas.gov",
    "www.sos.ok.gov", "oklahoma.gov", "www.oklegislature.gov", "www.sos.state.tx.us", "www.sos.texas.gov", "statutes.capitol.texas.gov", "comptroller.texas.gov",
    "www.twc.texas.gov", "www.tdi.texas.gov", "hawaii.gov", "cca.hawaii.gov", "www.capitol.hawaii.gov", "labor.hawaii.gov", "www.commerce.alaska.gov",
    "www.akleg.gov", "labor.alaska.gov", "www.maine.gov", "legislature.maine.gov", "www.nh.gov", "www.gencourt.state.nh.us", "gc.nh.gov", "www.oplc.nh.gov",
    "sos.vermont.gov", "legislature.vermont.gov", "www.ri.gov", "www.crb.ri.gov", "webserver.rilegislature.gov", "www.sos.ri.gov", "dlt.ri.gov",
    "oehs.wvdhhr.org", "dhhr.wv.gov", "oisc.purdue.edu", "www.kyagr.com", "www.laworks.net", "nmda.nmsu.edu",
    "delcode.delaware.gov", "corp.delaware.gov", "dpr.delaware.gov", "revenue.delaware.gov", "dlcp.dc.gov", "code.dccouncil.gov", "dc.gov", "otr.dc.gov",
}


def norm(s):
    s = html.unescape(s or "")
    s = s.replace(" ", " ").replace("­", "")
    s = re.sub(r"[‘’‚′`]", "'", s)
    s = re.sub(r"[“”„″]", '"', s)
    s = re.sub(r"[‐-―−]", "-", s)
    s = s.replace("…", "...")
    s = re.sub(r"-\s*\n\s*", "-", s)
    return re.sub(r"\s+", " ", s).strip().lower()


def html_text(raw):
    t = re.sub(r"<(script|style|noscript)\b[\s\S]*?</\1\s*>", " ", raw, flags=re.I)
    t = re.sub(r"<br\s*/?>|</(p|div|li|tr|h\d|td|th)>", "\n", t, flags=re.I)
    return re.sub(r"<[^>]+>", " ", t)


def fetch_one(url):
    key = hashlib.sha256(url.encode()).hexdigest()[:24]
    path = os.path.join(CACHE, key)
    if not os.path.exists(path + ".txt"):
        raw = path + ".raw"
        r = subprocess.run(["curl", "-sSL", "--compressed", "--max-time", "45", "--retry", "2", "-A", "Mozilla/5.0 (compatible; academy-source-check)",
                            "-o", raw, "-w", "%{http_code} %{content_type}", url], capture_output=True, text=True)
        code, _, ctype = (r.stdout or "0 ").partition(" ")
        if not os.path.exists(raw) or not code.startswith("2"):
            return None, f"HTTP {code or 'error'}"
        with open(raw, "rb") as f:
            head = f.read(5)
        if head.startswith(b"%PDF") or "pdf" in ctype:
            text = subprocess.run(["pdftotext", "-layout", raw, "-"], capture_output=True, text=True).stdout
        else:
            with open(raw, "rb") as f:
                b = f.read()
            try:
                page = b.decode("utf-8")
            except UnicodeDecodeError:
                page = b.decode("cp1252", "replace")
            text = html_text(page)
        with open(path + ".txt", "w") as f:
            f.write(text)
        time.sleep(0.4)
    with open(path + ".txt") as f:
        return f.read(), None


def fetch(url):
    """Page text, plus the first two same-host PDFs it links to (rules often live in a linked PDF)."""
    text, err = fetch_one(url)
    if text is None:
        return text, err
    raw = os.path.join(CACHE, hashlib.sha256(url.encode()).hexdigest()[:24] + ".raw")
    try:
        with open(raw, "rb") as f:
            body = f.read(3_000_000).decode("utf-8", "replace")
    except OSError:
        return text, err
    if body.startswith("%PDF"):
        return text, err
    host = urlparse(url).hostname
    links = []
    for href in re.findall(r'href="([^"]+\.pdf)"', body, flags=re.I):
        full = urljoin(url, html.unescape(href))
        if urlparse(full).hostname == host and full not in links:
            links.append(full)
    for link in links[:2]:
        extra, _ = fetch_one(link)
        if extra:
            text += "\n" + extra
    return text, err


def quote_found(quote, page):
    np = norm(page)
    npc = re.sub(r"[\s\"'.,;:()\-]", "", np)
    q0 = re.sub(r"\[[^\]]{3,200}\]", " ... ", quote or "")
    parts = [p.strip() for p in re.split(r"\.\.\.|…", q0) if len(p.strip()) >= 12]
    if not parts:
        return False
    for p in parts:
        q = norm(p).strip(" .\"'")
        if q in np or re.sub(r"[\s\"'.,;:()\-]", "", q) in npc:
            continue
        return False
    return True


NUM_RE = re.compile(r"\$\s?[\d,]+(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\s?%|\b\d[\d,]*(?:\.\d+)?\b")
WORDNUM = {"one": "1", "two": "2", "three": "3", "four": "4", "five": "5", "six": "6", "seven": "7", "eight": "8", "nine": "9", "ten": "10"}


def numbers(text):
    out = set()
    for m in NUM_RE.findall(text or ""):
        n = re.sub(r"[^\d.]", "", m).rstrip(".")
        n = re.sub(r"\.0+$", "", n)
        if n and n not in {"1"}:  # "1" is too common ("one or more") to police
            out.add(n)
    return out


def quote_numbers(q):
    t = (q or "").lower()
    for w, d in WORDNUM.items():
        t = re.sub(rf"\b{w}\b", d, t)
    return numbers(t)


def check_fact(url, quote, cache):
    if not url or not quote:
        return "Official page or quote missing."
    if not official(url):
        return "Source is not an official government page."
    key = (url, quote)
    if key in cache:
        return cache[key]
    page, err = fetch(url)
    reason = None
    if not page:
        reason = f"Official page could not be re-checked ({err})."
    elif not quote_found(quote, page):
        reason = "Quoted text was not found on the official page when re-checked."
    cache[key] = reason
    return reason


def clean_text(v, n=600):
    return v.strip()[:n] if isinstance(v, str) and v.strip() else None


checked_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
cache = {}
summary = []
for fn in sorted(os.listdir(SRC)):
    if fn == "US.json":
        with open(os.path.join(SRC, fn)) as f:
            d = json.load(f)
        facts = []
        for o in d.get("facts") or []:
            row = {"key": o.get("key"), "name": clean_text(o.get("name"), 200), "agency": clean_text(o.get("agency"), 160),
                   "trades": [t for t in (o.get("trades") or []) if t in TRADES or t == "*"], "when": clean_text(o.get("when"), 300),
                   "summary": clean_text(o.get("summary")), "url": o.get("url"), "link": o.get("link") if o.get("link") and official(o["link"]) else o.get("url"),
                   "quote": clean_text(o.get("quote"), 800)}
            row["pending_reason"] = check_fact(row["url"], row["quote"], cache)
            if not row["pending_reason"]:
                bad = sorted(n for n in numbers(f"{row['summary'] or ''} {row['when'] or ''}") if n not in quote_numbers(row["quote"]))
                if bad:
                    row["pending_reason"] = f"Number(s) {', '.join(bad)} not found in the verified quote."
            row["status_check"] = "pending_review" if row["pending_reason"] else "verified"
            facts.append(row)
        with open(os.path.join(OUT_DIR, "US.json"), "w") as f:
            json.dump({"checked_at": checked_at, "facts": facts}, f, indent=1, ensure_ascii=False)
            f.write("\n")
        summary.append(f"US: {sum(r['status_check'] == 'verified' for r in facts)} verified / {sum(r['status_check'] != 'verified' for r in facts)} pending")
        continue
    if not re.fullmatch(r"[A-Z]{2}\.json", fn) or fn[:2] not in STATES:
        continue
    st = fn[:2]
    with open(os.path.join(SRC, fn)) as f:
        d = json.load(f)
    counts = {"verified": 0, "pending_review": 0}

    def finish(row, quotes):
        """row has url/quote checked already in row['pending_reason']; police numbers in our own words."""
        if not row["pending_reason"]:
            ok_nums = set()
            for q in quotes:
                ok_nums |= quote_numbers(q)
            own = " ".join(str(row.get(k) or "") for k in ("summary", "threshold", "bond", "insurance", "covers"))
            own += " " + " ".join(row.get("prerequisites") or [])
            bad = sorted(n for n in numbers(own) if n not in ok_nums)
            if bad:
                row["pending_reason"] = f"Number(s) {', '.join(bad)} not found in the verified quotes."
        row["status_check"] = "pending_review" if row["pending_reason"] else "verified"
        counts[row["status_check"]] += 1
        return row

    general = {}
    for k in GENERAL:
        g = (d.get("general") or {}).get(k)
        if not isinstance(g, dict):
            continue
        row = {"agency": clean_text(g.get("agency"), 160), "summary": clean_text(g.get("summary")), "url": g.get("url"), "quote": clean_text(g.get("quote"), 800)}
        row["pending_reason"] = check_fact(row["url"], row["quote"], cache) if row["summary"] else "No summary."
        general[k] = finish(row, [row["quote"]])

    creds = {}
    for k in CATEGORIES:
        c = (d.get("credentials") or {}).get(k)
        if not isinstance(c, dict):
            creds[k] = {"status": "unknown", "summary": None, "status_check": "pending_review", "pending_reason": "Not researched."}
            counts["pending_review"] += 1
            continue
        status = c.get("status") if c.get("status") in STATUSES else "unknown"
        row = {"status": status, "name": clean_text(c.get("name"), 200), "agency": clean_text(c.get("agency"), 160), "covers": clean_text(c.get("covers"), 400),
               "threshold": clean_text(c.get("threshold"), 300), "prerequisites": [p.strip()[:300] for p in (c.get("prerequisites") or []) if isinstance(p, str) and p.strip()][:8],
               "bond": clean_text(c.get("bond"), 300), "insurance": clean_text(c.get("insurance"), 300), "summary": clean_text(c.get("summary"), 900),
               "url": c.get("url"), "quote": clean_text(c.get("quote"), 800), "note": clean_text(c.get("note"), 500), "evidence": []}
        quotes = []
        if status == "unknown":
            row["pending_reason"] = "Not confirmed from an official source."
        else:
            row["pending_reason"] = check_fact(row["url"], row["quote"], cache)
            if not row["pending_reason"]:
                quotes.append(row["quote"])
            for e in (c.get("evidence") or [])[:6]:
                if isinstance(e, dict) and not check_fact(e.get("url"), e.get("quote"), cache):
                    row["evidence"].append({"url": e["url"], "quote": e["quote"][:800]})
                    quotes.append(e["quote"])
        creds[k] = finish(row, quotes)

    others = []
    for o in (d.get("credentials") or {}).get("other") or []:
        if not isinstance(o, dict) or not clean_text(o.get("name")):
            continue
        row = {"key": re.sub(r"[^a-z0-9_]", "", str(o.get("key") or "other").lower())[:40] or "other", "name": clean_text(o.get("name"), 200), "agency": clean_text(o.get("agency"), 160),
               "trades": [t for t in (o.get("trades") or []) if t in TRADES], "summary": clean_text(o.get("summary")), "url": o.get("url"), "quote": clean_text(o.get("quote"), 800)}
        row["pending_reason"] = check_fact(row["url"], row["quote"], cache)
        others.append(finish(row, [row["quote"]]))

    out = {"state": st, "researched_on": d.get("researched_on"), "checked_at": checked_at, "general": general, "credentials": creds, "other": others}
    with open(os.path.join(OUT_DIR, f"{st}.json"), "w") as f:
        json.dump(out, f, indent=1, ensure_ascii=False)
        f.write("\n")
    summary.append(f"{st}: {counts['verified']} verified / {counts['pending_review']} pending")

print("\n".join(summary))

# Static index so the app bundles every checked state file (no filesystem reads at runtime).
files = sorted(f[:-5] for f in os.listdir(OUT_DIR) if re.fullmatch(r"[A-Z]{2}\.json", f))
with open(os.path.join(OUT_DIR, "index.ts"), "w") as f:
    f.write("// Generated by scripts/academy/startup/check_startup_evidence.py. Do not edit by hand.\n")
    f.write('import type { FederalFile, StateFile } from "../types";\n')
    for st in files:
        f.write(f'import {st} from "./{st}.json";\n')
    f.write("\nexport const FEDERAL = US as unknown as FederalFile;\n" if "US" in files else "\nexport const FEDERAL: FederalFile = { checked_at: \"\", facts: [] };\n")
    states = [s for s in files if s != "US"]
    f.write("export const STATE_FILES: Record<string, StateFile> = {\n")
    for st in states:
        f.write(f"  {st}: {st} as unknown as StateFile,\n")
    f.write("};\n")
