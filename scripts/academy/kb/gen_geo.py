#!/usr/bin/env python3
"""
Builds the Academy's ZIP -> permitting-area picker data for all 50 states + DC from public-domain U.S. Census
Bureau 2020 relationship files (ZCTA to county, county subdivision and place). Writes public/academy-geo/<zip3>.json,
loaded by the browser one 3-digit shard at a time. A ZIP never decides the authority: these are the CHOICES shown
("Rochester", "Cascade Township, Olmsted County", "Unincorporated Olmsted County"), ordered by land overlap.

  python3 scripts/academy/kb/gen_geo.py <dir with tab20_zcta520_{county20,cousub20,place20}_natl.txt>
Source: https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/
"""
import collections, json, os, re, sys

FIPS = {"01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE", "11": "DC", "12": "FL", "13": "GA",
        "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME", "24": "MD", "25": "MA",
        "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY",
        "37": "NC", "38": "ND", "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD", "47": "TN", "48": "TX",
        "49": "UT", "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI", "56": "WY"}
MIN_SHARE = 0.02


def slug(s):
    s = re.sub(r"\bste\.?\s", "sainte ", re.sub(r"\bst\.?\s", "saint ", s.lower() + " ")).replace("&", " and ")
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", s)).strip("-")[:60]


def county_base(name):
    return re.sub(r"\s+(County|Parish|Borough|City and Borough|Census Area|Municipality|Municipio|city)$", "", name)


def rows(path):
    with open(path, encoding="utf-8-sig") as f:
        head = f.readline().rstrip("\n").split("|")
        for line in f:
            v = dict(zip(head, line.rstrip("\n").split("|")))
            if v.get("GEOID_ZCTA5_20"):
                yield v


def place_base(name):
    return re.sub(r"\s+(city|town|village|borough|municipality|CDP|city and borough|urban county|unified government|consolidated government|metro government|metropolitan government)(\s*\(.*\))?$", "", name, flags=re.I)


def main(src):
    zland = {}
    counties = collections.defaultdict(list)  # zcta -> [(county geoid, name, share)]
    cname = {}
    for v in rows(os.path.join(src, "tab20_zcta520_county20_natl.txt")):
        z, g = v["GEOID_ZCTA5_20"], v["GEOID_COUNTY_20"]
        if g[:2] not in FIPS:
            continue
        zland[z] = int(v["AREALAND_ZCTA5_20"] or 0) or 1
        cname[g] = v["NAMELSAD_COUNTY_20"]
        counties[z].append((g, int(v["AREALAND_PART"] or 0)))
    # Incorporated places only (CLASSFP C*): unincorporated CDPs are governed by the county.
    places = collections.defaultdict(list)
    pname = {}
    pland = {}
    for v in rows(os.path.join(src, "tab20_zcta520_place20_natl.txt")):
        g = v["GEOID_PLACE_20"]
        if g[:2] not in FIPS or not v["CLASSFP_PLACE_20"].startswith("C") or v["FUNCSTAT_PLACE_20"] not in ("A", "B"):
            continue
        pname[g] = v["NAMELSAD_PLACE_20"]
        pland[g] = int(v["AREALAND_PLACE_20"] or 0) or 1
        places[v["GEOID_ZCTA5_20"]].append((g, int(v["AREALAND_PART"] or 0)))
    # Active townships/towns that are governments of their own (CLASSFP T1), e.g. MN, WI, MI, PA, NJ, NY, OH, New England.
    towns = collections.defaultdict(list)
    tname = {}
    tland = {}
    for v in rows(os.path.join(src, "tab20_zcta520_cousub20_natl.txt")):
        g = v["GEOID_COUSUB_20"]
        if g[:2] not in FIPS or v["CLASSFP_COUSUB_20"] != "T1" or v["FUNCSTAT_COUSUB_20"] != "A":
            continue
        tname[g] = v["NAMELSAD_COUSUB_20"]
        tland[g] = int(v["AREALAND_COUSUB_20"] or 0) or 1
        towns[v["GEOID_ZCTA5_20"]].append((g, int(v["AREALAND_PART"] or 0)))

    # Unique place ids per state (append the county when two places share a name).
    place_county = {}
    for z, lst in places.items():
        for g, a in lst:
            best = max(counties.get(z, [("", 0)]), key=lambda c: c[1])[0]
            place_county.setdefault(g, best)
    seen = collections.Counter((g[:2], slug(place_base(n))) for g, n in pname.items())

    def pid(g):
        st, s = FIPS[g[:2]], slug(place_base(pname[g]))
        if seen[(g[:2], s)] > 1:
            s = f"{s}-{slug(county_base(cname.get(place_county.get(g, ''), '')))}"
        return f"{st}:{s}"

    def cid(g):
        return f"{FIPS[g[:2]]}:{slug(county_base(cname[g]))}-county"

    def tid(g):
        cg = g[:5]
        base = re.sub(r"\s+(township|town|charter township|plantation|gore|grant|location|purchase|reservation|unorganized territory)$", "", tname[g], flags=re.I)
        kind = "twp" if re.search(r"township$", tname[g], re.I) else "town"
        return f"{FIPS[g[:2]]}:{slug(county_base(cname.get(cg, cg)))}:{slug(base)}-{kind}"

    shards = collections.defaultdict(dict)
    for z, cl in counties.items():
        land = zland[z]
        opts = []
        # Listed when it covers a meaningful part of the ZIP, or the ZIP holds a meaningful part of it (small towns).
        for g, a in places.get(z, []):
            if a / land >= MIN_SHARE or a / pland[g] >= 0.2:
                opts.append((pid(g), place_base(pname[g]).strip(), "city", a / land))
        for g, a in towns.get(z, []):
            if a / land >= MIN_SHARE or a / tland[g] >= 0.2:
                cg = g[:5]
                label = re.sub(r"\b(township|town|plantation)$", lambda m: m.group(1).title(), tname[g].strip())
                opts.append((tid(g), f"{label}, {cname.get(cg, '')}", "township", a / land))
        covered = sum(o[3] for o in opts)
        for g, a in cl:
            if FIPS[g[:2]] == "DC":
                opts.append(("DC:district-of-columbia", "District of Columbia", "city", 1.0))
                continue
            # Land in this county that is not inside a listed city or township is governed by the county.
            share = max(0.0, a / land - covered) if len(cl) == 1 else max(0.0, a / land * (1 - covered))
            if share >= MIN_SHARE or not opts:
                opts.append((cid(g), f"Unincorporated {cname[g]}", "county", share if opts else a / land))
        opts.sort(key=lambda o: (-o[3], o[1]))
        shards[z[:3]][z] = [[o[0], o[1], o[2], round(o[3], 2)] for o in opts]
    dups = sorted(f"{FIPS[st]}:{sl}" for (st, sl), n in seen.items() if n > 1)
    with open("src/lib/academy/kb/seed/place-dups.json", "w") as f:
        json.dump(dups, f, indent=0)
    out = "public/academy-geo"
    os.makedirs(out, exist_ok=True)
    for k, v in shards.items():
        with open(os.path.join(out, f"{k}.json"), "w") as f:
            json.dump(v, f, separators=(",", ":"))
    print(f"{sum(len(v) for v in shards.values())} ZIPs in {len(shards)} shards", file=sys.stderr)


if __name__ == "__main__":
    main(sys.argv[1])
