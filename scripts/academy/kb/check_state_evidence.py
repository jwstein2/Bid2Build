#!/usr/bin/env python3
"""
Re-checks researched statewide code adoptions against the official pages before anything is marked verified.

Input:  a folder of <ST>.json research files (schema in docs/academy/expansion/README.md, "State adoptions").
Output: src/lib/academy/kb/seed/state-adoptions.json

For every adoption the evidence page is fetched again (HTML -> text, PDF -> pdftotext) and the quoted evidence must
appear word for word (whitespace, quote marks and dashes normalized; "..." splits a quote into parts that must each
appear). Only then is it kept as "verified", with the SHA-256 of the page text. Anything else becomes pending_review
with the reason. Only official government hosts (.gov, .us, state legislature/admin-code hosts) are accepted.

Run: python3 -I scripts/academy/kb/check_state_evidence.py /tmp/claude-0/states [cache_dir]
"""
import hashlib, html, json, os, re, subprocess, sys, tempfile, time
from urllib.parse import urljoin, urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
OUT = os.path.join(ROOT, "src/lib/academy/kb/seed/state-adoptions.json")
SRC = sys.argv[1]
CACHE = sys.argv[2] if len(sys.argv) > 2 else os.path.join(tempfile.gettempdir(), "b2b-state-evidence")
os.makedirs(CACHE, exist_ok=True)

STATES = set("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split())
FAMILIES = {"irc", "ibc", "iebc", "ipc", "upc", "imc", "umc", "ifgc", "nfpa54", "ifc", "nfpa1", "iecc", "ashrae_90_1", "nec",
            "state_residential", "state_building", "state_plumbing", "state_energy", "state_mechanical"}
MODELS = {"statewide_mandatory", "statewide_minimum_local_enforcement", "local_option", "no_statewide_residential", "mixed"}
# Official hosts: government TLDs plus state legal-publication hosts that are not on .gov.
EXTRA_OFFICIAL = {"www.revisor.mn.gov", "codes.ohio.gov", "www.pacodeandbulletin.gov", "www.legislature.mi.gov", "le.utah.gov",
                  "www.azleg.gov", "apps.azsos.gov", "www.sos.state.oh.us", "www.ilga.gov", "ilga.gov", "www.flrules.org", "flrules.org",
                  "www.leg.state.nv.us", "publications.tnsosfiles.com", "sos-prod.tnsosgovfiles.com", "www.leg.state.fl.us", "www.flsenate.gov", "www.floridabuilding.org", "floridabuilding.org", "codes.findlaw.com"}
BLOCKED = {"codes.findlaw.com"}  # never evidence (commercial mirror)


def official(url):
    try:
        u = urlparse(url)
    except Exception:
        return False
    h = (u.hostname or "").lower()
    if u.scheme != "https" or h in BLOCKED:
        return False
    return h.endswith(".gov") or h.endswith(".us") or h in EXTRA_OFFICIAL or bool(re.search(r"\.(state|legis|leg)\.[a-z]{2}\.us$", h))


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
    t = re.sub(r"<br\s*/?>|</(p|div|li|tr|h\d)>", "\n", t, flags=re.I)
    t = re.sub(r"<[^>]+>", " ", t)
    return t


def fetch(url, follow=True):
    """Page text. For an HTML page that publishes its rule as a linked PDF on the same host (e.g. "View Rule Text"),
    the first two such PDFs are appended, since the official text lives there."""
    text, err = fetch_one(url)
    if text is None or not follow:
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


def fetch_one(url):
    key = hashlib.sha256(url.encode()).hexdigest()[:24]
    path = os.path.join(CACHE, key)
    if not os.path.exists(path + ".txt"):
        raw = path + ".raw"
        r = subprocess.run(["curl", "-sSL", "--max-time", "45", "--retry", "2", "-A", "Mozilla/5.0 (compatible; academy-source-check)",
                            "-o", raw, "-w", "%{http_code} %{content_type}", url], capture_output=True, text=True)
        code, _, ctype = (r.stdout or "0 ").partition(" ")
        if not os.path.exists(raw) or not code.startswith("2"):
            return None, f"HTTP {code or 'error'}"
        with open(raw, "rb") as f:
            head = f.read(5)
        if head.startswith(b"%PDF") or "pdf" in ctype:
            p = subprocess.run(["pdftotext", "-layout", raw, "-"], capture_output=True, text=True)
            text = p.stdout
        else:
            with open(raw, "rb") as f:
                b = f.read()
            try:
                page = b.decode("utf-8")
            except UnicodeDecodeError:
                page = b.decode("cp1252", "replace")  # older state pages (e.g. Word-exported HTML)
            text = html_text(page)
        with open(path + ".txt", "w") as f:
            f.write(text)
        time.sleep(0.5)
    with open(path + ".txt") as f:
        return f.read(), None


def quote_found(quote, page):
    np = norm(page)
    npc = re.sub(r"[\s\"'.,;:()\-]", "", np)
    # Researcher notes in [brackets] are not part of the quote; "..." and a skipped list item "(b)" split it into parts.
    q0 = re.sub(r"\[[^\]]{3,200}\]", " ... ", quote or "")
    # 'Page A: "quote" | Page B: "quote"' -> only the quoted text counts.
    if " | " in q0 and q0.count('"') >= 2:
        q0 = " ... ".join(re.findall(r'"([^"]{12,})"', q0))
    parts = [p.strip() for p in re.split(r"\.\.\.|…|\s(?=\([a-z0-9]{1,3}\)\s)", q0) if len(p.strip()) >= 12]
    if not parts:
        return False
    for p in parts:
        q = norm(p).strip(" .\"'")
        if q in np:
            continue
        if re.sub(r"[\s\"'.,;:()\-]", "", q) in npc:  # tolerate layout/punctuation spacing from PDFs
            continue
        return False
    return True


def date_ok(d):
    return d is None or bool(re.fullmatch(r"\d{4}-\d{2}-\d{2}", d))


out = {"checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "states": {}}
summary = []
for fn in sorted(os.listdir(SRC)):
    if not re.fullmatch(r"[A-Z]{2}\.json", fn):
        continue
    st = fn[:2]
    if st not in STATES or st == "MN":
        continue
    with open(os.path.join(SRC, fn)) as f:
        d = json.load(f)
    model = d.get("model") if d.get("model") in MODELS else None
    model_ok = False
    if model and d.get("model_evidence_url") and official(d["model_evidence_url"]):
        page, err = fetch(d["model_evidence_url"])
        model_ok = bool(page) and quote_found(d.get("model_evidence_quote"), page)
    rows = []
    for a in d.get("adoptions", []):
        fam = a.get("family")
        if fam not in FAMILIES:
            continue
        row = {k: a.get(k) for k in ("family", "model_edition", "state_code_name", "applies_to", "authority_citation", "official_url", "effective_date",
                                      "statewide", "local_amendments_allowed", "scope_note", "evidence_quote", "evidence_url")}
        reason = a.get("pending_reason") if a.get("status") != "verified" else None
        if not reason and not (row["authority_citation"] and row["official_url"] and official(row["official_url"])):
            reason = "Official adoption page or citation missing."
        if not reason and not (row["evidence_url"] and official(row["evidence_url"])):
            reason = "Evidence is not from an official government page."
        if not reason and not date_ok(row["effective_date"]):
            reason = "Effective date is not a plain date."
        if not reason and row["model_edition"] is not None and not re.fullmatch(r"(19|20)\d\d", str(row["model_edition"])):
            reason = "Model code edition is not a year."
        page_hash = None
        if not reason:
            page, err = fetch(row["evidence_url"])
            if page and row["official_url"] != row["evidence_url"] and not quote_found(row["evidence_quote"], page):
                more, _ = fetch(row["official_url"])  # a quote may combine the evidence page and the adoption page
                page = page + "\n" + (more or "")
            if not page:
                reason = f"Official page could not be re-checked ({err})."
            elif not quote_found(row["evidence_quote"], page):
                reason = "Quoted evidence was not found on the official page when re-checked."
            else:
                page_hash = hashlib.sha256(norm(page).encode()).hexdigest()
        row["status"] = "pending_review" if reason else "verified"
        row["pending_reason"] = reason
        row["page_hash"] = page_hash
        rows.append(row)
    v = sum(r["status"] == "verified" for r in rows)
    summary.append(f"{st}: {v} verified / {len(rows) - v} pending · model {'ok' if model_ok else 'unconfirmed'}")
    out["states"][st] = {
        "model": model if model_ok else None, "model_note": d.get("model_note") if model_ok else None,
        "model_evidence_url": d.get("model_evidence_url") if model_ok else None, "model_evidence_quote": d.get("model_evidence_quote") if model_ok else None,
        "local_directory_url": d.get("local_directory_url") if d.get("local_directory_url") and official(d["local_directory_url"]) else None,
        "notes": (d.get("notes") or "")[:1500] or None, "adoptions": rows,
    }

with open(OUT, "w") as f:
    json.dump(out, f, indent=1, ensure_ascii=False)
    f.write("\n")
print("\n".join(summary))
print(f"wrote {OUT}")
