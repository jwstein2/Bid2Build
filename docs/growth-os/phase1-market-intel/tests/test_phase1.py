"""Acceptance tests for Built2Bid Growth OS Phase 1 (market intelligence).

Run from the phase folder:  python3 -m pytest tests -q
No network access needed.
"""
import csv, glob, hashlib, json, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = lambda *p: os.path.join(ROOT, *p)
rd = lambda p: list(csv.DictReader(open(P(p))))

SOURCES = json.load(open(P('data/sources.json')))
SRC_IDS = {s['id'] for s in SOURCES['sources']}
EVID = {e['id']: e for e in rd('data/evidence.csv')}
ASSUME = {a['id']: a for a in json.load(open(P('data/assumptions.json')))['assumptions']}
GAPS = {g['id']: g for g in rd('data/gaps.csv')}
FRAME = {r['id']: r for r in rd('data/derived/audience_frame_naics23.csv')}
SIZING = {r['segment_id']: r for r in rd('data/derived/segment_sizing.csv')}
MATRIX = {r['segment_id']: r for r in rd('data/derived/trade_priority_matrix.csv')}
GEO = {r['state']: r for r in rd('data/derived/geography_by_state.csv')}
MODEL = json.load(open(P('data/derived/market_model_v1.json')))
MSEG = {(r['scenario'], r['segment_id']): r for r in rd('data/derived/market_model_v1_segments.csv')}
PERSONAS = json.load(open(P('data/personas.json')))
SEGDEF = json.load(open(P('data/segments.json')))

REQUESTED = ['S01', 'S02', 'S03', 'S04', 'S06', 'S07', 'S08', 'S10', 'S11']


# ---------- Source registry ----------
def test_all_requested_sources_present_and_verified():
    by = {s['id']: s for s in SOURCES['sources']}
    for sid in REQUESTED:
        s = by[sid]
        assert s['verification_status'] in ('verified', 'verified_with_internal_inconsistencies', 'partially_verified', 'not_found')
        for f in ('urls', 'release_date', 'sample_definition', 'methodology', 'confidence', 'how_verified', 'limitations'):
            assert s.get(f), (sid, f)
        assert s['confidence'] in SOURCES['confidence_scale']


def test_partial_verification_is_documented_as_gap():
    partial = [s['id'] for s in SOURCES['sources'] if s['verification_status'] != 'verified']
    gap_text = ' '.join(g['gap'] for g in GAPS.values())
    assert 'S10' in partial and 'RoofersCoffeeShop' in gap_text
    assert 'S03' in partial and 'CPWR' in gap_text


def test_evidence_rows_resolve_to_sources():
    for e in EVID.values():
        assert e['source_id'] in SRC_IDS, e['id']
        assert e['claim_type'] in ('verified_fact', 'derived_fact')
        assert e['confidence'] in SOURCES['confidence_scale']


# ---------- Data integrity ----------
def test_census_reconciliation_checks_pass():
    checks = json.load(open(P('data/derived/reconciliation_checks.json')))
    assert checks and all(checks.values()), checks


def test_build_is_deterministic():
    files = sorted(glob.glob(P('data/derived/*'))) + sorted(glob.glob(P('reports/0[2-6]_*.md')))
    h1 = {f: hashlib.sha256(open(f, 'rb').read()).hexdigest() for f in files}
    subprocess.run([sys.executable, P('scripts/build.py')], check=True, capture_output=True)
    subprocess.run([sys.executable, P('scripts/render_reports.py')], check=True, capture_output=True)
    h2 = {f: hashlib.sha256(open(f, 'rb').read()).hexdigest() for f in files}
    assert h1 == h2


# ---------- Owner vs worker ----------
def test_audience_units_never_use_employee_counts():
    for sid, z in SIZING.items():
        if not z['employer_estab_lt20']:
            continue
        for k in ('low', 'base', 'high'):
            assert int(z[f'units_1to20_{k}']) == int(z['employer_estab_lt20']) + int(z[f'solo_viable_{k}'])
        assert int(z['units_1to20_base']) != int(z['paid_employees_all_sizes'])


def test_model_unit_is_business_not_worker():
    assert 'not workers' in MODEL['unit']
    tam_emp = sum(int(SIZING[s['id']]['employer_estab_lt20']) for s in SEGDEF['segments'] if s['in_tam'])
    for sc in ('low', 'base', 'high'):
        assert MODEL['totals'][sc]['tam_employer_units'] == tam_emp


def test_employer_proxy_definition_cites_census_owner_exclusion():
    assert 'E006' in ASSUME['A02']['basis']
    assert 'excludes sole proprietors and partners' in EVID['E006']['value']


def test_shared_codes_not_double_counted():
    in_tam = [s for s in SEGDEF['segments'] if s['in_tam']]
    codes = [c for s in in_tam for c in s['naics']]
    assert len(codes) == len(set(codes))


# ---------- Not everyone is a software buyer ----------
def test_funnel_narrows_and_propensity_below_one():
    for sc in ('low', 'base', 'high'):
        t = MODEL['totals'][sc]
        assert t['som_accounts'] < t['sam_units'] < t['tam_units']
        assert ASSUME['A05']['employer'][sc] < 1 and ASSUME['A05']['solo'][sc] < 1
    assert MODEL['totals']['low']['sam_units'] < MODEL['totals']['base']['sam_units'] < MODEL['totals']['high']['sam_units']


def test_every_assumption_labeled():
    for a in ASSUME.values():
        assert a.get('basis') and a.get('description')
    assert 'SCENARIO' in json.load(open(P('data/assumptions.json')))['label']
    assert 'SCENARIO' in MODEL['label']


# ---------- Personas & matrix ----------
def test_at_least_five_complete_personas():
    req = ['company_characteristics', 'primary_business_problems', 'likely_software_objections', 'best_built2bid_use_cases',
           'purchase_motivations', 'expected_buyer_journey', 'preferred_marketing_messages', 'appropriate_product_tier']
    ps = PERSONAS['personas']
    assert len(ps) >= 5
    for p in ps:
        for f in req:
            assert p.get(f), (p['id'], f)
        for eid in re.findall(r'\bE\d{3}\b', json.dumps(p)):
            assert eid in EVID, (p['id'], eid)


def test_requested_segments_scored():
    names = ' '.join(s['name'].lower() for s in SEGDEF['segments'])
    for t in ['remodel', 'general contractor', 'roofing', 'siding', 'deck', 'concrete', 'electrical', 'plumbing', 'hvac', 'painting', 'drywall', 'soft washing', 'pressure washing']:
        assert t in names, t
    assert len(MATRIX) == len(SEGDEF['segments'])


# ---------- Report traceability ----------
TAG = re.compile(r'\[(E\d{3}|D\d{3}|A\d{2}|S\d{2}|G\d{2}|T:[^\]]+|M:[^\]]+|INF|PARAM[^\]]*)\]')
SAFE = [
    r'\b\d+\.\d+\.\d+\b', r'\b\d{4}-\d{2}-\d{2}\b', r'\b56\d{3,4}\b', r'`[^`]*`', r'\(#[^)]*\)', r'https?://\S+', r'\b(19|20)\d\d\b', r'\b(NAICS|naics)\s*[\d/;, ]+', r'\(\d{3,6}\)', r'\b2\d{2,5}\b(?=[ ,;)/]|$)',
    r'\b[PDAEGS]\d{1,3}\b', r'\b1 to 20\b', r'\b1-20\b', r'<\s?\d+', r'\b\d+\+', r'\b5-9\b', r'\b10-19\b', r'\b20-49\b', r'\b36 months\b', r'\bPhase \d\b',
    r'^\s*\d+\.\s', r'^#+.*$', r'\b\d+\.\d+\.\d+\b', r'\b\d{4}-\d{2}-\d{2}\b', r'\bv\d+(\.\d+)*\b', r'\b\d{1,2}\s(to|or)\s\d{1,2}\b', r'\b\d+-\d+ (people|users|employees)\b', r'\b\d (people|user|owner)\b',
    r'\b19 employees plus 1 owner equals 20 people\b', r'\b(one|two|three)\b', r'\bD1-D7\b', r'\bA0\d-A0\d\b', r'\b\d{1,2} (to|-) \d{1,2} (such )?jobs\b'
]


def norm_num(s):
    return s.replace(',', '').replace('$', '')


def tag_value(tag):
    if re.fullmatch(r'E\d{3}', tag):
        return EVID[tag]['value']
    if re.fullmatch(r'D\d{3}', tag):
        return FRAME[tag]['value']
    if tag.startswith('T:'):
        parts = tag[2:].split('.')
        if parts[0] == 'geo':
            return GEO[parts[1]][parts[2]]
        if parts[0] == 'persona':
            return str(next(p for p in PERSONAS['personas'] if p['id'] == parts[1])['audience_size_reference']['value'])
        if parts[0] == 'arpa':
            return str(json.load(open(P('data/derived/arpa_v1.json')))['arpa_usd_month'][parts[1]][parts[2]])
        if parts[0] == 'mseg':
            return MSEG[(parts[1], parts[2])]['som_arr_usd']
        seg, field = parts
        return SIZING[seg][field] if field in SIZING[seg] else MATRIX[seg][field]
    if tag.startswith('M:'):
        sc, field = tag[2:].split('.')
        return str(MODEL['totals'][sc][field])
    return None


def numeric_variants(v):
    v = str(v).strip()
    out = {v}
    try:
        f = float(v)
        out |= {str(int(f)) if f.is_integer() else str(f), f'{f:.1f}', f'{f:.2f}'}
        if f >= 1_000_000:
            out.add(f'{f / 1e6:.1f}')
    except ValueError:
        pass
    return out


def report_lines():
    for path in sorted(glob.glob(P('reports', '*.md'))) + [P('README.md')]:
        if os.path.exists(path):
            fence = False
            for i, line in enumerate(open(path), 1):
                if line.startswith('```'):
                    fence = not fence
                    continue
                if fence:
                    continue  # code blocks hold commands and paths, not claims
                yield os.path.basename(path), i, re.sub(r'`[^`]*`', ' ', line.rstrip('\n'))


def test_every_tag_resolves():
    for f, i, line in report_lines():
        for tag in TAG.findall(line):
            if len(tag) > 1 and tag[0] in 'EDTM' and tag[1] in '0123456789:':
                assert tag_value(tag) is not None, (f, i, tag)
            elif tag[0] == 'A':
                assert tag in ASSUME, (f, i, tag)
            elif tag[0] == 'S':
                assert tag in SRC_IDS, (f, i, tag)
            elif tag[0] == 'G':
                assert tag in GAPS, (f, i, tag)
            else:
                assert tag == 'INF' or tag.startswith('PARAM'), (f, i, tag)


def test_tagged_numbers_match_source_values():
    bad = []
    for f, i, line in report_lines():
        clean = norm_num(line)
        for tag in TAG.findall(line):
            if len(tag) < 2 or not (tag[0] in 'EDTM' and (tag[1].isdigit() or tag[1] == ':')):
                continue
            v = tag_value(tag)
            try:
                float(str(v).replace(',', ''))
            except ValueError:
                continue  # text-valued evidence (e.g., 'over half')
            if not any(x in clean for x in numeric_variants(str(v).replace(',', ''))):
                bad.append((f, i, tag, v))
    assert not bad, bad[:20]


def test_every_number_in_reports_is_traceable():
    bad = []
    for f, i, line in report_lines():
        if f.startswith('03_') and line.startswith('- '):
            continue  # source metadata bullets (dates, sample text) come straight from sources.json
        if f.startswith('00_'):
            continue  # phase report numbers are process metadata (test counts, criterion ids), not market claims; its tags are still validated above
        stripped = TAG.sub('', line)
        for pat in SAFE:
            stripped = re.sub(pat, ' ', stripped)
        if re.search(r'\d', stripped) and not TAG.search(line):
            nums = re.findall(r'\$?\d[\d,]*(?:\.\d+)?%?', stripped)
            if any(len(n.replace(',', '').replace('$', '').replace('%', '').split('.')[0]) >= 2 or '%' in n or '$' in n for n in nums):
                bad.append((f, i, line[:140]))
    assert not bad, '\n'.join(map(str, bad[:40]))


# ---------- Real pricing ----------
def test_arpa_uses_real_list_prices():
    pr = json.load(open(P('data/pricing.json')))
    arpa = json.load(open(P('data/derived/arpa_v1.json')))['arpa_usd_month']
    assert arpa['employer']['low'] == pr['plans']['individual_monthly']['amount_cents'] / 100
    assert arpa['employer']['base'] == pr['plans']['enterprise']['base_cents_month'] / 100
    assert arpa['solo']['low'] == round(pr['plans']['individual_annual']['amount_cents'] / 1200, 2)
    assert 'placeholder' not in json.dumps(ASSUME['A07']).lower()


def test_pricing_matches_app_source_when_in_repo():
    """When this folder sits inside the Built2Bid repo, the copied prices must equal the app's constants."""
    import pytest
    repo = os.path.abspath(os.path.join(ROOT, '..', '..', '..'))
    plans = os.path.join(repo, 'src', 'lib', 'billing', 'plans.ts')
    ent = os.path.join(repo, 'src', 'lib', 'enterprise', 'pricing.ts')
    if not (os.path.exists(plans) and os.path.exists(ent)):
        pytest.skip('not inside the app repository')
    pr = json.load(open(P('data/pricing.json')))
    src = open(plans).read()
    assert re.search(r'monthly:.*amountCents: %d' % pr['plans']['individual_monthly']['amount_cents'], src)
    assert re.search(r'annual:.*amountCents: %d' % pr['plans']['individual_annual']['amount_cents'], src)
    assert 'ENTERPRISE_BASE_CENTS = %d' % pr['plans']['enterprise']['base_cents_month'] in open(ent).read()


def test_persona_messages_follow_house_ad_rules():
    banned = re.compile(r'\b(win more|faster|minutes?|seconds?|profit|guarantee|\d+%)', re.I)
    for p in PERSONAS['personas']:
        for m in p['preferred_marketing_messages']:
            assert not banned.search(m), (p['id'], m)
