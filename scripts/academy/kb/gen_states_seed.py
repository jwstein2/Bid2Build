#!/usr/bin/env python3
"""
Generates supabase/migrations/20270222003000_academy_kb_states_seed.sql from
src/lib/academy/kb/seed/state-adoptions.json (written by check_state_evidence.py, which re-checks every quote).

Adds, for every state + DC (Minnesota is seeded separately):
  * code families the states use that were not seeded yet (UPC, UMC, NFPA 1, NFPA 54, ASHRAE 90.1, state-written codes)
  * model code editions (citation + link only, never their text) and state-written codes (title, citation, link)
  * each statewide adoption, with its legal citation, official URL, effective date and scope
  * a verification record (official page URL, the quote found on it and the page's SHA-256) for every verified row
  * the state's code model note and official local directory, without overwriting anything an admin changed

Idempotent: deterministic ids + ON CONFLICT DO NOTHING. Run: python3 -I scripts/academy/kb/gen_states_seed.py
"""
import json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
DATA = json.load(open(os.path.join(ROOT, "src/lib/academy/kb/seed/state-adoptions.json")))
OUT = os.path.join(ROOT, "supabase/migrations/20270222003000_academy_kb_states_seed.sql")
AT = DATA["checked_at"]

MODEL = {  # family -> (title pattern, short, publisher)
    "irc": ("International Residential Code", "IRC", "International Code Council"),
    "ibc": ("International Building Code", "IBC", "International Code Council"),
    "iebc": ("International Existing Building Code", "IEBC", "International Code Council"),
    "ipc": ("International Plumbing Code", "IPC", "International Code Council"),
    "imc": ("International Mechanical Code", "IMC", "International Code Council"),
    "ifgc": ("International Fuel Gas Code", "IFGC", "International Code Council"),
    "ifc": ("International Fire Code", "IFC", "International Code Council"),
    "iecc": ("International Energy Conservation Code", "IECC", "International Code Council"),
    "nec": ("National Electrical Code (NFPA 70)", "NEC", "National Fire Protection Association"),
    "upc": ("Uniform Plumbing Code", "UPC", "International Association of Plumbing and Mechanical Officials (IAPMO)"),
    "umc": ("Uniform Mechanical Code", "UMC", "International Association of Plumbing and Mechanical Officials (IAPMO)"),
    "nfpa1": ("NFPA 1 Fire Code", "NFPA 1", "National Fire Protection Association"),
    "nfpa54": ("National Fuel Gas Code (NFPA 54)", "NFPA 54", "National Fire Protection Association"),
    "ashrae_90_1": ("ASHRAE Standard 90.1 (Energy Standard for Sites and Buildings)", "ASHRAE 90.1", "ASHRAE"),
}
NEW_FAMILIES = [
    ("upc", "Uniform Plumbing Code", "UPC", "model_code", "IAPMO", "Model plumbing code used by many western and midwestern states instead of the IPC. Enforceable only where adopted.", 41),
    ("umc", "Uniform Mechanical Code", "UMC", "model_code", "IAPMO", "Model mechanical code used by some states instead of the IMC. Enforceable only where adopted.", 51),
    ("nfpa54", "National Fuel Gas Code (NFPA 54)", "NFPA 54", "standard", "National Fire Protection Association (NFPA)", "Fuel gas piping and appliance standard some states adopt instead of the IFGC.", 61),
    ("nfpa1", "NFPA 1 Fire Code", "NFPA 1", "standard", "National Fire Protection Association (NFPA)", "Fire code some states adopt instead of the International Fire Code.", 71),
    ("ashrae_90_1", "ASHRAE Standard 90.1", "ASHRAE 90.1", "standard", "ASHRAE", "Commercial building energy standard. Often allowed as an alternative to the commercial IECC.", 81),
    ("state_code", "State-Written Construction Codes", "State code", "state_code", None, "Codes a state writes itself (for example a state plumbing code or a state residential energy code), not based on one model code edition.", 190),
]
MODEL_NOTE = "Copyrighted model code. Built2Bid stores the title, edition and section citations only. Read the text through the publisher, a licensed copy, or your building department."
STATE_NOTE = "Official state law. Built2Bid links to the official text and cites it; it is not reproduced here."
MODEL_TEXT = {
    "statewide_mandatory": "One code applies statewide.",
    "statewide_minimum_local_enforcement": "The state sets a minimum code; cities and counties enforce it, sometimes with local amendments.",
    "local_option": "No statewide code for most private construction; cities and counties choose and enforce their own.",
    "no_statewide_residential": "No statewide code for one- and two-family homes; other buildings follow state rules.",
    "mixed": "Some codes apply statewide; others only where a city or county adopts them.",
}
APPLIES = {"residential": "Residential.", "commercial": "Commercial and other non-residential buildings.", "all": None}


def q(v):
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def uid(key):
    return f"md5({q('academykb:' + key)})::uuid"


def slug(s):
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", (s or "").lower())).strip("-")[:50]


def clip(s, n):
    s = re.sub(r"\s+", " ", s or "").strip()
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


sources, adoptions, verifs, juris = {}, [], [], []
for st, d in sorted(DATA["states"].items()):
    for a in d["adoptions"]:
        fam, ed = a["family"], a["model_edition"]
        if not a["authority_citation"] or not (a["official_url"] or "").startswith("https://"):
            continue
        verified = a["status"] == "verified"
        if fam in MODEL and ed:
            key = f"{fam}-{ed}"
            title, short, pub = MODEL[fam]
            s = sources.setdefault(key, {"family": fam, "title": f"{ed} {title}" if fam != "nec" else f"National Electrical Code, {ed} edition (NFPA 70)",
                                         "short": short, "edition": str(ed), "year": int(ed), "publisher": pub, "jurisdiction": None, "official": None,
                                         "rights": "metadata_only", "note": MODEL_NOTE, "verified_by": None})
        else:
            name = clip(a["state_code_name"] or f"{st} {fam.replace('_', ' ')}", 160)
            key = f"st:{st}:{fam}:{slug(name)}"
            year = int(ed) if ed else (int(a["effective_date"][:4]) if a["effective_date"] else None)
            s = sources.setdefault(key, {"family": "state_code" if fam not in MODEL else fam, "title": name, "short": clip(name, 60),
                                         "edition": str(year) if year else "Current", "year": year, "publisher": f"State of {st}" if st != "DC" else "District of Columbia",
                                         "jurisdiction": st, "official": a["official_url"], "rights": "government_edict", "note": STATE_NOTE, "verified_by": None})
            if fam in MODEL:  # model family with no edition named (e.g. "current edition" by statute): keep as a state source
                s["family"] = "state_code"
        if verified and not s["verified_by"]:
            s["verified_by"] = (st, a)
        bits = [a["state_code_name"] and f"{clip(a['state_code_name'], 160)}.", APPLIES.get(a["applies_to"] or "all"),
                "Applies statewide." if a["statewide"] else "Applies only where a local government adopts or enforces it, or to the buildings the state regulates." if a["statewide"] is False else None,
                "Local amendments are allowed." if a["local_amendments_allowed"] else "Local governments may not amend it." if a["local_amendments_allowed"] is False else None,
                a["scope_note"] and clip(a["scope_note"], 900)]
        akey = f"adoption:st:{st}:{fam}:{ed or '-'}:{a['applies_to'] or 'all'}:{slug(a['state_code_name'] or '')}"
        if any(x["key"] == akey for x in adoptions):  # the same code listed twice for one state: keep the first
            continue
        adoptions.append({"key": akey, "st": st, "source": key, "scope": clip(" ".join(b for b in bits if b), 2000),
                          "authority": clip(a["authority_citation"], 200), "url": a["official_url"], "effective": a["effective_date"],
                          "localconf": not (a["statewide"] is True and a["local_amendments_allowed"] is False),
                          "status": "verified" if verified else "pending_review", "notes": clip(a["pending_reason"], 2000) if not verified else None})
        if verified:
            verifs.append(("adoption", akey, a["evidence_url"], a["page_hash"], clip(a["evidence_quote"], 4000),
                           "Quote re-checked word for word on the official page by the Academy source check."))
    v = sum(x["status"] == "verified" for x in d["adoptions"])
    if d["model"] or v:
        note = " ".join(x for x in [d["model_note"] and clip(d["model_note"], 900), MODEL_TEXT.get(d["model"] or "")] if x) or None
        juris.append((st, "partial" if v else "awaiting_verification", note, d["local_directory_url"]))
        if d["model"] and d["model_evidence_url"]:
            verifs.append(("jurisdiction", st, d["model_evidence_url"], None, clip(d["model_evidence_quote"], 4000), "Statewide code model, re-checked on the official page."))

for key, s in sources.items():
    s["status"] = "verified" if s["verified_by"] else "pending_review"
    if s["verified_by"]:
        st, a = s["verified_by"]
        verifs.append(("source", f"source:{key}", a["evidence_url"], a["page_hash"], clip(a["evidence_quote"], 4000),
                       f"Edition confirmed by {st}'s official adopting text." if s["rights"] == "metadata_only" else "Confirmed on the official state page."))

L = [f"""-- Generated by scripts/academy/kb/gen_states_seed.py from src/lib/academy/kb/seed/state-adoptions.json. Do not edit by hand.
-- Statewide construction code adoptions for 49 states + DC (Minnesota is in 20270220002000). Every "verified" row's quote was
-- re-checked word for word on the official government page ({AT}); everything else is pending_review with the reason.
-- Safe to re-run: deterministic ids + ON CONFLICT DO NOTHING; jurisdiction notes are only filled where still empty.
-- Requires 20270220001000_academy_knowledge.sql and 20270222001000_academy_kb_local.sql.

select set_config('academy.kb_verifying', 'on', false);
"""]
L.append("insert into public.academy_kb_families (slug, name, short_name, kind, publisher, about, sort_order) values")
L.append(",\n".join(f"  ({', '.join(q(x) for x in f)})" for f in NEW_FAMILIES) + "\non conflict (slug) do nothing;\n")
L.append("insert into public.academy_kb_sources (id, family_slug, title, short_title, edition, edition_year, publisher, jurisdiction_id, official_url, read_url, rights, fulltext_allowed, excerpt_allowed, rights_note, pagination_note, status, check_url, last_verified_at, last_checked_at) values")
L.append(",\n".join(
    f"  ({uid('source:' + k)}, {q(s['family'])}, {q(s['title'])}, {q(s['short'])}, {q(s['edition'])}, {q(s['year'])}, {q(s['publisher'])}, {q(s['jurisdiction'])}, {q(s['official'])}, {q(s['official'])}, "
    f"{q(s['rights'])}, false, false, {q(s['note'])}, {q('Built2Bid cites sections only; page numbers differ between formats.' if s['rights'] == 'metadata_only' else None)}, {q(s['status'])}, {q(s['official'])}, "
    f"{(q(AT) + '::timestamptz') if s['status'] == 'verified' else 'null'}, {q(AT)}::timestamptz)"
    for k, s in sorted(sources.items())) + "\non conflict do nothing;\n")
ADOPT_HEAD = "insert into public.academy_kb_adoptions (id, jurisdiction_id, source_id, kind, replaces_family, scope_note, authority_citation, official_url, effective_date, expiration_date, local_confirmation_required, trades, status, last_verified_at, notes) values"
VERIF_HEAD = "insert into public.academy_kb_verifications (target_type, target_id, checked_at, method, result, source_url, content_hash, evidence, notes) values"


def chunked(head, rows, size):
    """Several INSERTs of at most `size` rows, so each statement fits a SQL Editor paste."""
    for i in range(0, len(rows), size):
        L.append(head)
        L.append(",\n".join(rows[i:i + size]) + "\non conflict do nothing;\n")


adopt_rows = (
    f"  ({uid(a['key'])}, {q(a['st'])}, {uid('source:' + a['source'])}, 'adopts', null, {q(a['scope'])}, {q(a['authority'])}, {q(a['url'])}, "
    f"{(q(a['effective']) + '::date') if a['effective'] else 'null'}, null, {q(a['localconf'])}, '{{}}'::text[], {q(a['status'])}, "
    f"{(q(AT) + '::timestamptz') if a['status'] == 'verified' else 'null'}, {q(a['notes'])})" for a in adoptions)
chunked(ADOPT_HEAD, list(adopt_rows), 60)
L.append("create unique index if not exists academy_kb_verifications_once on public.academy_kb_verifications (target_type, target_id, checked_at, method);")
verif_rows = (
    f"  ({q(t)}, {('(' + uid(k) + ')::text') if t != 'jurisdiction' else q(k)}, {q(AT)}::timestamptz, 'official_text', 'verified', {q(u)}, {q(h)}, {q(e)}, {q(n)})"
    for t, k, u, h, e, n in verifs)
chunked(VERIF_HEAD, list(verif_rows), 40)
for st, cov, note, url in juris:
    L.append(f"update public.academy_kb_jurisdictions set coverage = {q(cov)}, notes = coalesce(notes, {q(note)}), building_dept_url = coalesce(building_dept_url, {q(url)}), updated_at = now()\n"
             f"  where id = {q(st)} and coverage = 'awaiting_verification';")
L.append("\nselect set_config('academy.kb_verifying', 'off', false);\n")
open(OUT, "w").write("\n".join(L))

# Rollback: removes exactly the rows this seed added (by their deterministic ids), never anything else.
RB = os.path.join(ROOT, "docs/academy/rollback_20270222003000.sql")
akeys = ", ".join(uid(a["key"]) for a in adoptions)
skeys = ", ".join(uid("source:" + k) for k in sources if k.startswith("st:"))
R = [f"""-- Rollback for 20270222003000_academy_kb_states_seed.sql (generated). Removes only rows that seed added.
begin;
delete from public.academy_kb_verifications where target_type = 'adoption' and target_id in (select x::text from unnest(array[{akeys}]) x);
delete from public.academy_kb_adoptions where id in ({akeys});
delete from public.academy_kb_verifications where target_type = 'source' and target_id in (select s.id::text from public.academy_kb_sources s
  where s.id in ({skeys}) or (s.rights = 'metadata_only' and not exists (select 1 from public.academy_kb_adoptions a where a.source_id = s.id) and not exists (select 1 from public.academy_kb_sections x where x.source_id = s.id)));
delete from public.academy_kb_sources where id in ({skeys});
delete from public.academy_kb_sources s where s.rights = 'metadata_only' and s.family_slug in ('upc','umc','nfpa1','nfpa54','ashrae_90_1','irc','ibc','iebc','ipc','imc','ifgc','ifc','iecc','nec')
  and not exists (select 1 from public.academy_kb_adoptions a where a.source_id = s.id) and not exists (select 1 from public.academy_kb_sections x where x.source_id = s.id)
  and s.last_checked_at = {q(AT)}::timestamptz;
delete from public.academy_kb_verifications where target_type = 'jurisdiction' and checked_at = {q(AT)}::timestamptz;
update public.academy_kb_jurisdictions set coverage = 'awaiting_verification' where level = 'state' and id <> 'MN' and coverage = 'partial'
  and not exists (select 1 from public.academy_kb_adoptions a where a.jurisdiction_id = academy_kb_jurisdictions.id and a.status = 'verified' and a.kind <> 'replaces');
delete from public.academy_kb_families f where f.slug in ('upc','umc','nfpa1','nfpa54','ashrae_90_1','state_code') and not exists (select 1 from public.academy_kb_sources s where s.family_slug = f.slug);
commit;
"""]
open(RB, "w").write("\n".join(R))
print(f"wrote {OUT}: {len(sources)} sources, {len(adoptions)} adoptions ({sum(a['status'] == 'verified' for a in adoptions)} verified), {len(verifs)} verifications, {len(juris)} states")
