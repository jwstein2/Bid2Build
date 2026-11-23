#!/usr/bin/env python3
"""Deterministic build for Built2Bid Growth OS Phase 1 market intelligence.

Reads only files under data/ (raw Census extracts, evidence, assumptions, segments)
and writes derived tables to data/derived/. No network calls, no AI calls.
Run:  python3 scripts/build.py
"""
import csv, json, os, math

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = lambda *p: os.path.join(ROOT, 'data', *p)
OUT = D('derived')
os.makedirs(OUT, exist_ok=True)

STATE_FIPS = {'01':'AL','02':'AK','04':'AZ','05':'AR','06':'CA','08':'CO','09':'CT','10':'DE','11':'DC','12':'FL','13':'GA','15':'HI','16':'ID','17':'IL','18':'IN','19':'IA','20':'KS','21':'KY','22':'LA','23':'ME','24':'MD','25':'MA','26':'MI','27':'MN','28':'MS','29':'MO','30':'MT','31':'NE','32':'NV','33':'NH','34':'NJ','35':'NM','36':'NY','37':'NC','38':'ND','39':'OH','40':'OK','41':'OR','42':'PA','44':'RI','45':'SC','46':'SD','47':'TN','48':'TX','49':'UT','50':'VT','51':'VA','53':'WA','54':'WV','55':'WI','56':'WY'}
SIZE_LOW = {'111':0,'118':5000,'119':10000,'121':25000,'122':50000,'123':100000,'125':250000,'131':500000,'133':1000000,'141':2500000}


def load_cbp():
    rows = {}
    with open(D('raw', 'cbp23_us_naics23.csv')) as f:
        for r in csv.DictReader(f):
            rows[r['naics']] = {k: int(v) for k, v in r.items() if k != 'naics'}
    return rows


def load_nes():
    tot, sizes, lfo = {}, {}, {}
    with open(D('raw', 'nes24_us_naics23.csv')) as f:
        for r in csv.DictReader(f):
            n = r['naics']
            if r['lfo'] == '-' and r['rcptot_size'] == '001':
                tot[n] = (int(r['estab']), int(r['rcptot_k']))
            elif r['lfo'] == '-':
                sizes.setdefault(n, {})[r['rcptot_size']] = int(r['estab'])
            else:
                lfo.setdefault(n, {})[r['lfo']] = int(r['estab'])
    return tot, sizes, lfo


def share_at_or_above(sizes, floor):
    tot = sum(sizes.values())
    keep = sum(v for k, v in sizes.items() if SIZE_LOW[k] >= floor)
    return keep / tot if tot else 0.0


def enterprise_monthly_cents(pr, users):
    e = pr['plans']['enterprise']
    cents = e['base_cents_month']
    for t in e['seat_tiers']:
        last = t['last_user'] if t['last_user'] is not None else users
        n = max(0, min(users, last) - t['first_user'] + 1)
        cents += n * t['unit_cents']
    return cents


def compute_arpa(pr, a07):
    """ARPA per paying account per month from real list prices (S13); only the mix is assumed (A07)."""
    m = pr['plans']['individual_monthly']['amount_cents'] / 100
    y = pr['plans']['individual_annual']['amount_cents'] / 100 / 12
    att = a07['attach_rates_high']
    addons = sum(pr['add_ons'][k]['amount_cents'] / 100 * r for k, r in att.items())
    return {
        'solo': {'low': round(y, 2), 'base': round((m + y) / 2, 2), 'high': round(m + addons, 2)},
        'employer': {'low': round(m, 2), 'base': round(enterprise_monthly_cents(pr, 3) / 100, 2), 'high': round(enterprise_monthly_cents(pr, 5) / 100, 2)},
    }


def lt20(c):
    return c['n_lt5'] + c['n5_9'] + c['n10_19']


def main():
    cbp = load_cbp(); nes_tot, nes_sizes, nes_lfo = load_nes()
    A = {a['id']: a for a in json.load(open(D('assumptions.json')))['assumptions']}
    seg = json.load(open(D('segments.json')))
    floors = A['A01']  # low/base/high

    # ---------- 1. Audience frame: NAICS 23 totals (owner vs worker) ----------
    t = cbp['23----']
    frame = []
    def add(metric, value, unit, formula, ctype, inputs):
        frame.append({'id': f'D{len(frame)+1:03d}', 'metric': metric, 'value': value, 'unit': unit,
                      'formula': formula, 'claim_type': ctype, 'inputs': inputs})
    add('NAICS 23 employer establishments with <20 paid employees (1-20 total-people employer proxy)', lt20(t), 'establishments', 'n_lt5+n5_9+n10_19', 'derived_fact', 'E003,E004,E005,A02')
    add('Share of NAICS 23 employer establishments with <20 paid employees', round(lt20(t)/t['est']*100, 1), 'percent', 'lt20/est', 'derived_fact', 'E001,E003-E005')
    add('NAICS 23 employer establishments with 20+ paid employees (outside audience)', t['est']-lt20(t), 'establishments', 'est-lt20', 'derived_fact', 'E001,E003-E005')
    for k, fl in (('low', floors['low']), ('base', floors['base']), ('high', floors['high'])):
        s = share_at_or_above(nes_sizes['23'], fl)
        add(f'NAICS 23 nonemployers with receipts >= ${fl:,} (viable solo operators, {k} scenario floor)', round(nes_tot['23'][0]*s), 'establishments', 'sum of NES size classes >= floor', 'derived_fact', 'E010,E013-E017,A01')
    add('Share of NAICS 23 nonemployers with receipts < $10,000', round(share_at_or_above(nes_sizes['23'], 0) and (1-share_at_or_above(nes_sizes['23'], 10000))*100, 1), 'percent', '(size111+size118)/total', 'derived_fact', 'E010,E013,E014')
    add('Share of NAICS 23 nonemployers that are sole proprietorships', round(nes_lfo['23']['S']/nes_tot['23'][0]*100, 1), 'percent', 'LFO S / total', 'derived_fact', 'E010,E012')
    add('Average receipts per NAICS 23 nonemployer', round(nes_tot['23'][1]*1000/nes_tot['23'][0]), 'USD', 'receipts/estab', 'derived_fact', 'E010,E011')
    base_solo = round(nes_tot['23'][0]*share_at_or_above(nes_sizes['23'], floors['base']))
    add('NAICS 23 business units with 1-20 total people, base (employer <20 + solo >= base floor)', lt20(t)+base_solo, 'business units', 'D001 + base solo', 'derived_estimate', 'D001,A01,A02')
    add('Paid employees at NAICS 23 employer establishments (workers, NOT buyers)', t['emp'], 'employees', 'CBP emp', 'derived_fact', 'E002')
    add('Paid employees per NAICS 23 employer establishment with <20 employees is not published; CPWR reports 2.4M workers at <20-employee establishments in 2023', 2400000, 'workers', 'from CPWR', 'verified_fact', 'E032')
    with open(os.path.join(OUT, 'audience_frame_naics23.csv'), 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=list(frame[0].keys())); w.writeheader(); w.writerows(frame)

    # ---------- 2. Segment sizing ----------
    parent_lt5 = {}
    for s in seg['segments']:
        pass
    # parent group membership for allocation (6-digit children present in CBP extract)
    children = {
        '2361': ['236115', '236116', '236117', '236118'],
        '2362': ['236210', '236220'],
        '2381': ['238110', '238120', '238130', '238140', '238150', '238160', '238170', '238190'],
        '23821': ['238210'], '23822': ['238220'],
        '2383': ['238310', '238320', '238330', '238340', '238350', '238390'],
        '2389': ['238910', '238990'],
        '56179': ['561790'],
    }
    for p, kids in children.items():
        parent_lt5[p] = sum(cbp[k]['n_lt5'] for k in kids)

    sizing = []
    for s in seg['segments']:
        row = {'segment_id': s['id'], 'segment': s['name'], 'naics': ';'.join(s['naics']) or 'none',
               'in_tam': s['in_tam'], 'shared_count_with': s.get('shared_count_with', ''),
               'outside_naics23': s.get('outside_naics23', False)}
        if not s['naics']:
            row.update({k: '' for k in ['employer_estab_total', 'employer_estab_lt20', 'pct_employer_lt20', 'employer_estab_20plus',
                                         'nes_parent', 'nes_parent_estab', 'alloc_share', 'solo_all_est', 'solo_viable_low', 'solo_viable_base', 'solo_viable_high',
                                         'units_1to20_low', 'units_1to20_base', 'units_1to20_high', 'paid_employees_all_sizes']})
            row['method_note'] = s.get('count_note', '')
            row['confidence'] = 'not measurable'
            sizing.append(row); continue
        c = {k: sum(cbp[n][k] for n in s['naics']) for k in ['est', 'emp', 'n_lt5', 'n5_9', 'n10_19']}
        p = s['nes_parent']
        share = sum(cbp[n]['n_lt5'] for n in s['naics']) / parent_lt5[p]
        solo_all = nes_tot[p][0] * share
        sv = {k: solo_all * share_at_or_above(nes_sizes[p], floors[k]) for k in ('low', 'base', 'high')}
        e = lt20(c)
        row.update({
            'employer_estab_total': c['est'], 'employer_estab_lt20': e,
            'pct_employer_lt20': round(e / c['est'] * 100, 1), 'employer_estab_20plus': c['est'] - e,
            'nes_parent': p, 'nes_parent_estab': nes_tot[p][0], 'alloc_share': round(share, 4),
            'solo_all_est': round(solo_all), 'solo_viable_low': round(sv['low']), 'solo_viable_base': round(sv['base']), 'solo_viable_high': round(sv['high']),
            'units_1to20_low': e + round(sv['low']), 'units_1to20_base': e + round(sv['base']), 'units_1to20_high': e + round(sv['high']),
            'paid_employees_all_sizes': c['emp'],
            'method_note': ('Employer counts: CBP 2023 direct (A02). Solo counts: ' + ('NES 2024 direct (5-digit = 6-digit)' if share == 1 else f'ESTIMATE, NES 2024 {p} allocated by CBP <5 share (A03)') + '; viable = receipts floor A01.' + (' ' + s['count_note'] if s.get('count_note') else '')),
            'confidence': 'high (employer) / high (solo)' if share == 1 else 'high (employer) / low-medium (solo, allocated)'})
        sizing.append(row)
    fields = list(sizing[0].keys())
    with open(os.path.join(OUT, 'segment_sizing.csv'), 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=fields); w.writeheader(); w.writerows(sizing)
    size_by_id = {r['segment_id']: r for r in sizing}

    # ---------- 3. Trade Priority Matrix ----------
    dims = seg['scoring']['dimensions']
    def d1(n):
        if n == '' or n is None: return None
        return 5 if n >= 300000 else 4 if n >= 150000 else 3 if n >= 75000 else 2 if n >= 30000 else 1
    def d4(p):
        if p == '' or p is None: return None
        return 5 if p >= 95 else 4 if p >= 90 else 3 if p >= 80 else 2 if p >= 70 else 1
    matrix = []
    for s in seg['segments']:
        z = size_by_id[s['id']]
        sc = {'D1': d1(z['units_1to20_base']), 'D4': d4(z['pct_employer_lt20'])}
        basis = {'D1': 'data: units_1to20_base', 'D4': 'data: pct_employer_lt20'}
        if sc['D1'] is None:
            sc['D1'] = 2; basis['D1'] = 'PLACEHOLDER judgment (no Census code)'
        if sc['D4'] is None:
            sc['D4'] = 5; basis['D4'] = 'PLACEHOLDER judgment (no Census code)'
        for k, (v, b) in s['scores'].items():
            sc[k] = v; basis[k] = b
        wmap = {'D1': 'D1_audience_size', 'D2': 'D2_estimate_intensity', 'D3': 'D3_job_complexity_fit', 'D4': 'D4_owner_purchase_authority',
                'D5': 'D5_software_readiness', 'D6': 'D6_digital_reachability', 'D7': 'D7_competitive_whitespace'}
        total = sum(sc[k] * dims[wmap[k]]['weight'] for k in wmap)
        total = round(total, 2)
        ex_size = round(sum(sc[k] * dims[wmap[k]]['weight'] for k in wmap if k != 'D1') / (1 - dims['D1_audience_size']['weight']), 2)
        tier = 'P1' if total >= 3.75 else 'P2' if total >= 3.20 else 'P3'
        judg = sum(1 for k in wmap if not basis[k].startswith('data') and not any(x in basis[k] for x in ('E0', 'E1')))
        matrix.append({'segment_id': s['id'], 'segment': s['name'], 'units_1to20_base': z['units_1to20_base'],
                       **{k: sc[k] for k in wmap}, 'weighted_score': total, 'tier': tier, 'score_excluding_size': ex_size,
                       'judgment_only_dimensions': judg,
                       'score_confidence': 'medium' if judg <= 3 else 'low',
                       **{k + '_basis': basis[k] for k in wmap}})
    matrix.sort(key=lambda r: -r['weighted_score'])
    for i, r in enumerate(matrix, 1):
        r['rank'] = i
    with open(os.path.join(OUT, 'trade_priority_matrix.csv'), 'w', newline='') as f:
        flds = ['rank'] + [k for k in matrix[0].keys() if k != 'rank']
        w = csv.DictWriter(f, fieldnames=flds); w.writeheader(); w.writerows(matrix)
    tier_by_id = {r['segment_id']: r['tier'] for r in matrix}

    # ---------- 4. TAM / SAM / SOM scenario model ----------
    fit = A['A04']['tier_values']; prop = A['A05']; share = A['A06']; arpa = compute_arpa(json.load(open(D('pricing.json'))), A['A07'])
    json.dump({'source': 'data/pricing.json (S13) + plan mix A07', 'arpa_usd_month': arpa}, open(os.path.join(OUT, 'arpa_v1.json'), 'w'), indent=2)
    model_rows = []
    totals = {}
    for sc_name in ('low', 'base', 'high'):
        T = {'tam_employer': 0, 'tam_solo': 0, 'sam_employer': 0, 'sam_solo': 0}
        for s in seg['segments']:
            if not s['in_tam']:
                continue
            z = size_by_id[s['id']]
            tier = tier_by_id[s['id']]
            # if a shared-count segment's partner ranks higher, use the better tier for the shared count
            partner = s.get('shared_count_with')
            if partner and tier_by_id.get(partner, 'P3') < tier:
                tier = tier_by_id[partner]
            emp = z['employer_estab_lt20']; solo = z[f'solo_viable_{sc_name}']
            f_ = fit[tier][sc_name]
            sam_e = emp * f_ * prop['employer'][sc_name]
            sam_s = solo * f_ * prop['solo'][sc_name]
            som_e = sam_e * share[sc_name]; som_s = sam_s * share[sc_name]
            model_rows.append({'scenario': sc_name, 'segment_id': s['id'], 'tier_used': tier,
                               'tam_employer_units': emp, 'tam_solo_units': solo, 'tam_units': emp + solo,
                               'fit_weight': f_, 'propensity_employer': prop['employer'][sc_name], 'propensity_solo': prop['solo'][sc_name],
                               'sam_units': round(sam_e + sam_s), 'obtainable_share': share[sc_name],
                               'som_accounts': round(som_e + som_s),
                               'som_arr_usd': round(som_e * arpa['employer'][sc_name] * 12 + som_s * arpa['solo'][sc_name] * 12)})
            T['tam_employer'] += emp; T['tam_solo'] += solo; T['sam_employer'] += sam_e; T['sam_solo'] += sam_s
        som_e = T['sam_employer'] * share[sc_name]; som_s = T['sam_solo'] * share[sc_name]
        totals[sc_name] = {
            'tam_units': T['tam_employer'] + T['tam_solo'], 'tam_employer_units': T['tam_employer'], 'tam_solo_units': T['tam_solo'],
            'tam_annual_value_usd_at_arpa': round(T['tam_employer'] * arpa['employer'][sc_name] * 12 + T['tam_solo'] * arpa['solo'][sc_name] * 12),
            'sam_units': round(T['sam_employer'] + T['sam_solo']), 'sam_employer_units': round(T['sam_employer']), 'sam_solo_units': round(T['sam_solo']),
            'sam_annual_value_usd': round(T['sam_employer'] * arpa['employer'][sc_name] * 12 + T['sam_solo'] * arpa['solo'][sc_name] * 12),
            'som_accounts': round(som_e + som_s),
            'som_arr_usd': round(som_e * arpa['employer'][sc_name] * 12 + som_s * arpa['solo'][sc_name] * 12),
            'sam_pct_of_tam': round((T['sam_employer'] + T['sam_solo']) / (T['tam_employer'] + T['tam_solo']) * 100, 1),
        }
    with open(os.path.join(OUT, 'market_model_v1_segments.csv'), 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=list(model_rows[0].keys())); w.writeheader(); w.writerows(model_rows)
    json.dump({'model_version': json.load(open(D('assumptions.json')))['model_version'], 'model_date': '2026-11-23',
               'unit': 'business units (owner-level decision makers), not workers',
               'label': 'SCENARIO MODEL. TAM unit counts are Census-derived (with A02/A03 estimation rules). SAM, SOM and all dollar values depend on scenario assumptions A04-A07 and are not facts. ARPA uses real Built2Bid list prices (data/pricing.json); only the plan mix is assumed.',
               'assumptions_file': 'data/assumptions.json', 'totals': totals}, open(os.path.join(OUT, 'market_model_v1.json'), 'w'), indent=2)

    # ---------- 5. Geography ----------
    nes_codes = ['23', '2361', '2381', '23821', '23822', '2383', '2389']
    cbp_codes = ['23----', '236115', '236118', '236220', '238110', '238140', '238160', '238170', '238210', '238220', '238310', '238320', '238330', '238350', '238390', '238990']
    nes_st = {}
    for line in open(D('raw', 'nes24_state_raw.txt')):
        parts = line.strip().split(',')
        nes_st[parts[0]] = {c: int(v.split('|')[0]) for c, v in zip(nes_codes, parts[1:])}
    geo = []
    for line in open(D('raw', 'cbp23_state_raw.txt')):
        parts = line.strip().split(',')
        fips = parts[0]
        vals = dict(zip(cbp_codes, parts[1:]))
        def lt(code):
            v = vals.get(code, '')
            if not v or '|' not in v: return None
            a, b = v.split('|')
            return None if b == 'NaN' else int(b)
        r = {'fips': fips, 'state': STATE_FIPS[fips],
             'employer_estab_naics23': int(vals['23----'].split('|')[0]),
             'employer_estab_lt20_naics23': lt('23----'),
             'nonemployer_estab_naics23_all_receipts': nes_st[fips]['23']}
        r['business_units_naics23_employer_lt20_plus_all_nonemployers'] = r['employer_estab_lt20_naics23'] + r['nonemployer_estab_naics23_all_receipts']
        for code, name in [('236118', 'remodel'), ('238160', 'roofing'), ('238170', 'siding'), ('238110', 'concrete'), ('238210', 'electrical'), ('238220', 'plumbing_hvac'), ('238320', 'painting'), ('238310', 'drywall')]:
            r[f'employer_lt20_{name}'] = lt(code) if lt(code) is not None else ''
        geo.append(r)
    geo.sort(key=lambda r: -r['business_units_naics23_employer_lt20_plus_all_nonemployers'])
    tot_units = sum(r['business_units_naics23_employer_lt20_plus_all_nonemployers'] for r in geo)
    for i, r in enumerate(geo, 1):
        r['rank'] = i; r['share_of_us_pct'] = round(r['business_units_naics23_employer_lt20_plus_all_nonemployers'] / tot_units * 100, 2)
    with open(os.path.join(OUT, 'geography_by_state.csv'), 'w', newline='') as f:
        flds = ['rank', 'state', 'fips', 'share_of_us_pct'] + [k for k in geo[0] if k not in ('rank', 'state', 'fips', 'share_of_us_pct')]
        w = csv.DictWriter(f, fieldnames=flds); w.writeheader(); w.writerows(geo)

    # ---------- 6. Reconciliation checks recorded for tests ----------
    checks = {
        'cbp_6digit_children_sum_to_naics23_est': sum(cbp[n]['est'] for n in cbp if len(n) == 6 and n.isdigit() and n.startswith('23')) == cbp['23----']['est'],
        'nes_subsectors_sum_to_23': nes_tot['236'][0] + nes_tot['237'][0] + nes_tot['238'][0] == nes_tot['23'][0],
        'nes_238_groups_sum': nes_tot['2381'][0] + nes_tot['2382'][0] + nes_tot['2383'][0] + nes_tot['2389'][0] == nes_tot['238'][0],
        'nes_23_size_classes_sum_within_0.01pct': abs(sum(nes_sizes['23'].values()) - nes_tot['23'][0]) <= nes_tot['23'][0] * 0.0001,
        'state_nes_sum_to_us': sum(v['23'] for v in nes_st.values()) == nes_tot['23'][0],
        'state_cbp_sum_to_us_est': sum(r['employer_estab_naics23'] for r in geo) == cbp['23----']['est'],
    }
    json.dump(checks, open(os.path.join(OUT, 'reconciliation_checks.json'), 'w'), indent=2)
    print(json.dumps({'frame': [(r['id'], r['metric'][:60], r['value']) for r in frame], 'totals': totals, 'checks': checks}, indent=1))


if __name__ == '__main__':
    main()
