"""Phase 2 build: channel opportunity model, unit economics, budget scenarios, organic allocation.

Deterministic: reads data/*.json and the Phase 1 ARPA table, writes data/derived/*.
No network, no AI calls. Run from the phase folder:  python3 scripts/build.py
"""
import csv, json, math, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = lambda *p: os.path.join(ROOT, *p)
P1 = os.path.join(os.path.dirname(ROOT), 'phase1-market-intel')
SCEN = ['optimistic', 'base', 'conservative']

CH = json.load(open(P('data/channels.json')))['channels']
AS = {a['id']: a for a in json.load(open(P('data/assumptions.json')))['assumptions']}
RU = json.load(open(P('data/model_rules.json')))
ARPA_P1 = json.load(open(os.path.join(P1, 'data/derived/arpa_v1.json')))['arpa_usd_month']
OUT = P('data/derived')
os.makedirs(OUT, exist_ok=True)

DIMS = list(RU['weights'])
# Phase 1 ARPA scenarios are low/base/high; optimistic pairs with high.
P1MAP = {'optimistic': 'high', 'base': 'base', 'conservative': 'low'}


def r2(x):
    return None if x is None else round(x, 2)


def ceil_to(x, step):
    return int(math.ceil(x / step) * step)


def round_to(x, step):
    return int(round(x / step) * step)


# ---------- LTV ----------
def ltv_block():
    out = {}
    fee = AS['F09']['value']
    horizon = AS['F11']['value']
    for s in SCEN:
        emp = AS['F08']['value'][s]
        arpa = (1 - emp) * ARPA_P1['solo'][P1MAP[s]] + emp * ARPA_P1['employer'][P1MAP[s]]
        net = arpa * (1 - fee['pct'] / 100) - fee['fixed_usd']
        var = AS['F10']['value'][s] / 100
        gp = net * (1 - var)
        c = AS['F07']['value'][s] / 100
        life = (1 - (1 - c) ** horizon) / c
        out[s] = dict(employer_share=emp, arpa_usd_month=r2(arpa), net_revenue_usd_month=r2(net),
                      variable_cost_pct=AS['F10']['value'][s], gross_profit_usd_month=r2(gp),
                      contribution_margin_pct=r2(100 * gp / arpa),
                      monthly_churn_pct=AS['F07']['value'][s], expected_paid_months_capped=r2(life),
                      ltv_gross_profit_usd=r2(gp * life),
                      max_cac_for_payback_usd=r2(gp * RU['payback_target_months']))
    return out


# ---------- Unit economics per buy unit ----------
UNITS = sorted({c['buy_unit'] for c in CH if c['buy_unit']})


def unit_econ(u, s):
    cpc = AS['F01']['by_unit'][u][s]
    ctr = AS['F02']['by_unit'][u][s]
    lp = AS['F03']['by_unit'][u][s] / 100
    act = AS['F04']['value'][s] / 100 * AS['F05']['by_unit'][u]
    paid = AS['F06']['value'][s] / 100
    c2p = lp * act * paid
    return dict(unit=u, scenario=s, cpc_usd=cpc, ctr_pct=ctr, landing_conversion_pct=r2(lp * 100),
                activation_7d_pct=r2(act * 100), activated_to_paid_pct=r2(paid * 100),
                click_to_paid_pct=round(c2p * 100, 4), cost_per_signup_usd=r2(cpc / lp),
                cost_per_activated_usd=r2(cpc / (lp * act)), cac_usd=r2(cpc / c2p))


def cac_score(ratio):
    for floor, score in RU['cac_score_bands_ltv_to_cac']:
        if ratio >= floor:
            return score
    return 1


def main():
    LTV = ltv_block()
    UE = {(u, s): unit_econ(u, s) for u in UNITS for s in SCEN}

    # break-even
    be = []
    for u in UNITS:
        base = UE[(u, 'base')]
        maxcac = LTV['base']['max_cac_for_payback_usd']
        need = base['cpc_usd'] / maxcac
        be.append(dict(unit=u, base_cpc_usd=base['cpc_usd'], max_cac_usd_10mo_payback=maxcac,
                       required_click_to_paid_pct=round(need * 100, 3),
                       base_click_to_paid_pct=base['click_to_paid_pct'],
                       improvement_multiple_needed=r2(need * 100 / base['click_to_paid_pct'])))

    # ---------- Opportunity matrix ----------
    rows = []
    for c in CH:
        sc = {d: c['scores'][d][0] for d in DIMS}
        cac_note = 'judgment'
        if sc['expected_cac'] is None:
            ue = UE[(c['buy_unit'], 'base')]
            ratio = LTV['base']['ltv_gross_profit_usd'] / ue['cac_usd']
            sc['expected_cac'] = cac_score(ratio)
            cac_note = f"computed: base LTV/CAC = {ratio:.2f}"
        total = round(sum(RU['weights'][d] * sc[d] for d in DIMS), 2)
        rows.append(dict(channel_id=c['id'], channel=c['name'], buy_unit=c['buy_unit'] or '',
                         paid_eligible_type=c['paid_eligible'], **{d: sc[d] for d in DIMS},
                         expected_cac_basis=cac_note, opportunity_score=total))
    rows.sort(key=lambda r: -r['opportunity_score'])
    for i, r in enumerate(rows, 1):
        r['rank'] = i
    g = RU['paid_gates']
    for r in rows:
        why = []
        if not r['paid_eligible_type']:
            why.append('owned/organic channel (no paid media)')
        else:
            if r['measurability'] < g['min_measurability']:
                why.append(f"measurability {r['measurability']} < {g['min_measurability']}")
            if r['opportunity_score'] < g['min_opportunity_score']:
                why.append(f"score {r['opportunity_score']} < {g['min_opportunity_score']}")
        r['paid_gate'] = 'pass' if not why else 'fail'
        r['paid_gate_reason'] = '; '.join(why) or (
            'pass' if r['evidence_confidence'] >= g['min_evidence_confidence']
            else f"pass as exploratory only (evidence {r['evidence_confidence']}; budgets >= ${g['exploratory_from_budget']:,}) [PARAM]")
    write_csv('channel_opportunity_matrix.csv', rows)

    # unit view = best channel in the unit
    unit = {}
    for r in rows:
        u = r['buy_unit']
        if u and (u not in unit or r['opportunity_score'] > unit[u]['opportunity_score']):
            unit[u] = r

    # ---------- Budget scenarios ----------
    scen_out = []
    flat = []
    for B in RU['budgets']:
        reserve = round_to(B * RU['reserve_pct'] / 100, RU['reserve_round_usd']) if B >= RU['reserve_from_budget'] else 0
        pool = B - reserve
        cap_n = RU['max_paid_units_by_budget'][str(B)]
        cands = sorted([u for u in unit.values() if u['paid_gate'] == 'pass'], key=lambda r: -r['opportunity_score'])
        chosen, used, explo = [], 0, 0
        skipped = []
        for r in cands:
            u = r['buy_unit']
            mv = ceil_to(max(RU['platform_min_usd_month'][u], RU['min_clicks_per_month'] * AS['F01']['by_unit'][u]['base']), RU['allocation_round_usd'])
            exploratory = r['evidence_confidence'] < g['min_evidence_confidence']
            if exploratory and (B < g['exploratory_from_budget'] or explo >= g['max_exploratory_units']):
                skipped.append((u, 'exploratory channel not allowed at this budget')); continue
            if len(chosen) >= cap_n:
                skipped.append((u, f'channel limit {cap_n} at this budget')); continue
            if used + mv > pool:
                skipped.append((u, f'minimum viable ${mv} does not fit')); continue
            chosen.append(dict(unit=u, score=r['opportunity_score'], min_viable=mv, alloc=mv, exploratory=exploratory))
            used += mv
            explo += exploratory
        rem = pool - used
        for _ in range(20):  # proportional fill under caps
            open_ = [c for c in chosen if c['alloc'] < RU['unit_caps_usd_month'][c['unit']]
                     and not (c['exploratory'] and RU['exploratory_gets_min_viable_only'])]
            if rem < RU['allocation_round_usd'] or not open_:
                break
            tot = sum(c['score'] for c in open_)
            given = 0
            for c in open_:
                add = min(rem * c['score'] / tot, RU['unit_caps_usd_month'][c['unit']] - c['alloc'])
                add = int(add // RU['allocation_round_usd'] * RU['allocation_round_usd'])
                c['alloc'] += add
                given += add
            rem -= given
            if given == 0:
                break
        hold = rem
        lines = []
        for c in chosen:
            u, amt = c['unit'], c['alloc']
            line = dict(budget=B, unit=u, monthly_usd=amt, min_viable_usd=c['min_viable'], exploratory=c['exploratory'])
            for s in SCEN:
                ue = UE[(u, s)]
                clicks = amt / ue['cpc_usd']
                su = clicks * ue['landing_conversion_pct'] / 100
                ac = su * ue['activation_7d_pct'] / 100
                pd = ac * ue['activated_to_paid_pct'] / 100
                line[f'clicks_{s}'] = round(clicks)
                line[f'impressions_{s}'] = round(clicks / (ue['ctr_pct'] / 100)) if ue['ctr_pct'] else None
                line[f'signups_{s}'] = round(su, 1)
                line[f'activated_{s}'] = round(ac, 2)
                line[f'paid_{s}'] = round(pd, 3)
                line[f'cac_{s}'] = ue['cac_usd']
            n90 = line['clicks_base'] * RU['test_window_days'] / 30
            p = UE[(u, 'base')]['landing_conversion_pct'] / 100
            line['clicks_90d_base'] = round(n90)
            line['lp_conv_ci95_halfwidth_pts_90d'] = r2(196 * math.sqrt(p * (1 - p) / n90)) if n90 else None
            line['activated_90d_base'] = round(line['activated_base'] * 3, 1)
            line['months_to_3_paid_base'] = r2(3 / line['paid_base']) if line['paid_base'] else None
            line['months_to_3_paid_optimistic'] = r2(3 / line['paid_optimistic']) if line['paid_optimistic'] else None
            line['paid_conversion_readable_in_90d'] = line['activated_90d_base'] >= 30
            lines.append(line)
            flat.append(line)
        scen_out.append(dict(budget=B, reserve_usd=reserve, hold_unallocated_usd=hold, channel_limit=cap_n,
                             lines=lines, skipped=[{'unit': u, 'reason': why} for u, why in skipped],
                             zero_paid_units=sorted(set(UNITS) - {l['unit'] for l in lines})))
    write_csv('budget_scenarios.csv', flat)
    json.dump(dict(label='SCENARIO OUTPUTS. Every outcome comes from assumptions F01-F11 and rules in model_rules.json; none is a forecast or a measured result.', scenarios=scen_out), open(os.path.join(OUT, 'budget_scenarios.json'), 'w'), indent=1)

    # ---------- Organic allocation ----------
    ow = RU['organic_weights']
    orows = []
    for c in CH:
        s = (ow['audience_quality'] * c['scores']['audience_quality'][0] + ow['organic_opportunity'] * c['organic']['opportunity'][0]
             + ow['content_cost'] * c['scores']['content_cost'][0] + ow['measurability'] * c['scores']['measurability'][0])
        orows.append(dict(channel_id=c['id'], channel=c['name'], organic_score=round(s, 2), repurpose_only=c['organic']['repurpose_only'],
                          role=c['organic']['role'], cadence_at_base_hours=c['organic']['cadence_at_base_hours']))
    cap = RU['organic_repurpose_only_cap_share']
    rep = [r for r in orows if r['repurpose_only']]
    main_ = [r for r in orows if not r['repurpose_only']]
    for r in rep:
        r['time_share_pct'] = round(cap * 100, 1)
    left = 1 - cap * len(rep)
    tot = sum(r['organic_score'] ** 2 for r in main_)
    for r in main_:
        r['time_share_pct'] = round(100 * left * r['organic_score'] ** 2 / tot, 1)
    for k, h in RU['organic_hours_per_week'].items():
        for r in orows:
            r[f'hours_week_{k}'] = round(h * r['time_share_pct'] / 100, 1)
    orows.sort(key=lambda r: -r['time_share_pct'])
    write_csv('organic_allocation.csv', orows)

    write_csv('unit_economics.csv', list(UE.values()))
    write_csv('breakeven.csv', be)
    json.dump(LTV, open(os.path.join(OUT, 'ltv.json'), 'w'), indent=1)


def write_csv(name, rows):
    with open(os.path.join(OUT, name), 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)


if __name__ == '__main__':
    main()
