"""Acceptance tests for Built2Bid Growth OS Phase 2 (channel opportunity and allocation).

Run from the phase folder:  python3 -m pytest tests -q
No network access needed. Phase 1 must sit next to this folder (../phase1-market-intel).
"""
import csv, glob, hashlib, json, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = lambda *p: os.path.join(ROOT, *p)
P1 = os.path.join(os.path.dirname(ROOT), 'phase1-market-intel')
rd = lambda p: list(csv.DictReader(open(p)))

SRC = json.load(open(P('data/sources.json')))
SRC_IDS = {s['id'] for s in SRC['sources']}
EVID = {e['id']: e for e in rd(P('data/evidence.csv'))}
P1EVID = {e['id']: e for e in rd(os.path.join(P1, 'data/evidence.csv'))}
P1SRC = {s['id'] for s in json.load(open(os.path.join(P1, 'data/sources.json')))['sources']}
AS = {a['id']: a for a in json.load(open(P('data/assumptions.json')))['assumptions']}
RU = json.load(open(P('data/model_rules.json')))
CH = json.load(open(P('data/channels.json')))['channels']
EX = {x['id']: x for x in json.load(open(P('data/experiments.json')))['experiments']}
GAPS = {g['id'] for g in rd(P('data/gaps.csv'))}
MAT = {r['channel_id']: r for r in rd(P('data/derived/channel_opportunity_matrix.csv'))}
BS = json.load(open(P('data/derived/budget_scenarios.json')))['scenarios']
ORG = rd(P('data/derived/organic_allocation.csv'))
LTV = json.load(open(P('data/derived/ltv.json')))
TAG = re.compile(r'\[([A-Z][A-Za-z0-9:]*)\]')
REPORTS = sorted(glob.glob(P('reports', '*.md')))


def report_lines():
    for f in REPORTS:
        for i, line in enumerate(open(f), 1):
            yield os.path.basename(f), i, line.rstrip('\n')


def resolves(tag):
    if tag.startswith('P1:E'):
        return tag[3:] in P1EVID
    if tag.startswith('P1:S'):
        return tag[3:] in P1SRC
    if re.fullmatch(r'CE\d{3}', tag):
        return tag in EVID
    if re.fullmatch(r'C\d{2}', tag):
        return tag in SRC_IDS
    if re.fullmatch(r'F\d{2}', tag):
        return tag in AS
    if re.fullmatch(r'G2\d{2}', tag):
        return tag in GAPS
    if re.fullmatch(r'X\d{2}', tag):
        return tag in EX
    return tag in ('M', 'PARAM', 'INF')


# ---------- Sources and evidence ----------
def test_sources_complete():
    for s in SRC['sources']:
        for f in ('urls', 'release_date', 'sample_definition', 'methodology', 'confidence', 'limitations', 'how_verified'):
            assert s.get(f), (s['id'], f)
        assert s['confidence'] in SRC['confidence_scale']


def test_evidence_rows_resolve_and_are_facts():
    for e in EVID.values():
        assert e['source_id'] in SRC_IDS, e['id']
        assert e['claim_type'] in ('verified_fact', 'derived_fact')
        assert e['confidence'] in SRC['confidence_scale']


# ---------- Traceability ----------
def test_every_tag_resolves_in_reports_and_channel_data():
    bad = [(f, i, t) for f, i, l in report_lines() for t in TAG.findall(l) if not resolves(t)]
    text = open(P('data/channels.json')).read()
    bad += [('channels.json', 0, t) for t in TAG.findall(text) if not resolves(t)]
    for c in CH:
        for d, (s, basis, refs) in c['scores'].items():
            bad += [(c['id'], d, r) for r in refs if not resolves(r)]
    assert not bad, bad[:20]


def test_every_number_line_is_tagged():
    """Any report line with a percent or dollar figure carries at least one tag (headings excepted)."""
    bad = []
    for f, i, l in report_lines():
        if l.startswith('#') or not re.search(r'\d\s?%|\$\d', l):
            continue
        if not TAG.search(l):
            bad.append((f, i, l[:90]))
    assert not bad, bad[:20]


def tag_contexts():
    """Yield (file, line_no, line, tag, text_before_tag) where text_before_tag runs back to the previous tag."""
    for f, i, l in report_lines():
        last = 0
        for m in TAG.finditer(l):
            seg = l[last:m.start()].split('|')[-1][-80:]
            yield f, i, l, m.group(1), re.sub(r'\b(19|20)\d{2}\b', '', seg)
            last = m.end()


def evidence(t):
    return EVID.get(t) or (P1EVID.get(t[3:]) if t.startswith('P1:E') else None)


def test_tagged_evidence_numbers_match():
    """When a number is stated right before an evidence tag, the evidence value appears on that line."""
    bad = []
    for f, i, l, t, before in tag_contexts():
        e = evidence(t)
        if not e or not re.search(r'\d', before):
            continue
        try:
            v = float(e['value'].replace(',', ''))
        except ValueError:
            continue
        variants = {e['value'], f'{v:g}', f'{v:,.0f}', f'{v:.2f}'}
        if not any(x in l.replace('$', '') for x in variants):
            bad.append((f, i, t, e['value'], before))
    assert not bad, bad[:20]


def test_no_percentage_presented_as_contractor_statistic():
    """Cited percentages always name the population they describe (adults, surveyed owners, advertisers, products)."""
    words = ('adults', 'men', 'owners', 'advertisers', 'products', 'users', 'respondents')
    bad = []
    for f, i, l, t, before in tag_contexts():
        e = evidence(t)
        if e and e['unit'] == 'percent' and '%' in before and not any(w in l.lower() for w in words):
            bad.append((f, i, t))
    assert not bad, bad[:20]
    # no report calls a scenario or benchmark a verified contractor statistic
    for f, i, l in report_lines():
        assert not re.search(r'verified contractor (statistic|rate)', l, re.I) or 'not' in l.lower(), (f, i)


# ---------- Model structure ----------
def test_all_requested_channels_present_with_layers_and_profiles():
    names = ' '.join(c['name'].lower() for c in CH)
    for k in ('google search', 'facebook', 'instagram', 'youtube', 'tiktok', 'linkedin', 'email', 'communities', 'partnerships'):
        assert k in names, k
    layers = {'total_platform_adoption', 'construction_industry_adoption', 'business_owner_adoption',
              'reachable_ad_audience', 'qualified_lead_generation', 'customer_conversion_likelihood'}
    prof = {'intent', 'ad_formats', 'targeting', 'audience_verification', 'organic_opportunities', 'costs', 'restrictions'}
    for c in CH:
        assert set(c['layers']) == layers, c['id']
        assert prof <= set(c['profile']), c['id']
        assert all(c['layers'][k] for k in layers) and all(c['profile'][k] for k in prof)


def test_weights_cover_required_dimensions_and_exclude_adoption():
    req = {'audience_quality', 'purchase_intent', 'expected_cac', 'content_cost', 'measurability', 'competitive_pressure', 'evidence_confidence'}
    assert set(RU['weights']) == req
    assert abs(sum(RU['weights'].values()) - 1) < 1e-9
    assert not any('adoption' in k for k in RU['weights'])


def test_every_score_has_basis():
    for c in CH:
        for d, (s, basis, refs) in c['scores'].items():
            assert basis, (c['id'], d)
            assert s is None or 1 <= s <= 5
            if s is None:
                assert c['buy_unit'], 'only paid units have computed CAC'


def test_assumptions_needing_experiments_map_to_plan():
    for a in AS.values():
        assert a['basis'] and 'requires_experiment' in a
        if a['requires_experiment']:
            ids = re.findall(r'X\d{2}', a['experiment'])
            assert ids and all(x in EX for x in ids), a['id']
    for k in ('F01', 'F02', 'F03', 'F04', 'F06', 'F07'):  # CPC, CTR, landing, activation, paid, retention
        assert AS[k]['requires_experiment']
    assert 'F10' in AS  # contribution margin input


def test_experiment_plan_covers_30_60_90():
    wins = ' '.join(x['window'] for x in EX.values())
    for d in ('1-30', '31-60', '61-90'):
        assert d in wins
    for x in EX.values():
        for f in ('hypothesis', 'metric', 'decision', 'sample'):
            assert x[f]


# ---------- Budgets ----------
def test_five_budget_scenarios():
    assert [s['budget'] for s in BS] == [300, 500, 1000, 2500, 5000]


def test_allocations_sum_within_budget_and_respect_caps_and_minimums():
    for s in BS:
        total = sum(l['monthly_usd'] for l in s['lines']) + s['reserve_usd'] + s['hold_unallocated_usd']
        assert total == s['budget'], s['budget']
        for l in s['lines']:
            assert l['monthly_usd'] <= RU['unit_caps_usd_month'][l['unit']]
            assert l['monthly_usd'] >= l['min_viable_usd']
            assert l['monthly_usd'] >= RU['platform_min_usd_month'][l['unit']]
        assert len(s['lines']) <= RU['max_paid_units_by_budget'][str(s['budget'])]


def test_gated_channels_get_zero_paid_and_small_budgets_concentrate():
    failed = {MAT[c['id']]['buy_unit'] for c in CH if c['buy_unit'] and MAT[c['id']]['paid_gate'] == 'fail'}
    assert {'LINKEDIN', 'TIKTOK'} <= failed
    for s in BS:
        assert not failed & {l['unit'] for l in s['lines']}
        assert s['zero_paid_units']
    assert len(BS[0]['lines']) == 1 and len(BS[1]['lines']) == 1


def test_spend_not_proportional_to_adoption():
    """YouTube has the highest adult adoption [P1:E140] but never gets the largest paid share."""
    for s in BS:
        top = max(s['lines'], key=lambda l: l['monthly_usd'])['unit']
        assert top != 'YOUTUBE'


def test_every_budget_line_has_assumptions_evidence_outcome_uncertainty_validation():
    txt = open(P('reports/03_budget_scenarios.md')).read()
    for s in BS:
        for l in s['lines']:
            for k in ('clicks_base', 'signups_base', 'paid_base', 'cac_base', 'lp_conv_ci95_halfwidth_pts_90d', 'months_to_3_paid_base'):
                assert l[k] is not None, (s['budget'], l['unit'], k)
    for sec in txt.split('\n## $')[1:]:
        rows = [r for r in sec.splitlines() if r.startswith('| ') and ('Google' in r or 'Meta' in r or 'YouTube' in r or 'Creator' in r)]
        assert rows
        for r in rows:
            assert '[F0' in r or '[X0' in r, r[:80]


def test_ltv_uses_phase1_arpa():
    arpa = json.load(open(os.path.join(P1, 'data/derived/arpa_v1.json')))['arpa_usd_month']
    e = AS['F08']['value']['base']
    exp = (1 - e) * arpa['solo']['base'] + e * arpa['employer']['base']
    assert abs(LTV['base']['arpa_usd_month'] - round(exp, 2)) < 0.01


# ---------- Organic ----------
def test_organic_plan_covers_every_channel_and_sums_to_100():
    assert {r['channel_id'] for r in ORG} == {c['id'] for c in CH}
    assert abs(sum(float(r['time_share_pct']) for r in ORG) - 100) < 0.6
    for r in ORG:
        assert r['cadence_at_base_hours']


def test_copy_follows_house_ad_rules():
    banned = re.compile(r'win more|faster|in minutes|save \d|more profit|increase (your )?profit|\d+% (more|faster)', re.I)
    texts = [open(P('reports/04_organic_distribution_strategy.md')).read()]
    texts += [c['organic']['cadence_at_base_hours'] + ' ' + c['organic']['role'] for c in CH]
    for t in texts:
        for line in t.splitlines():
            if 'no speed' in line.lower():
                continue
            assert not banned.search(line), line


# ---------- Reproducibility ----------
def test_build_is_deterministic():
    files = sorted(glob.glob(P('data/derived/*'))) + REPORTS
    h1 = {f: hashlib.sha256(open(f, 'rb').read()).hexdigest() for f in files}
    subprocess.check_call([sys.executable, P('scripts/build.py')])
    subprocess.check_call([sys.executable, P('scripts/render_reports.py')])
    h2 = {f: hashlib.sha256(open(f, 'rb').read()).hexdigest() for f in files}
    assert h1 == h2
