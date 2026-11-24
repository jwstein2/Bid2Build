# Raw extracts (unmodified values)

All values below were read directly from U.S. Census Bureau public bulk files on 2026-11-23 through a browser session (the Census API now requires a key; the bulk files do not). No values were edited.

| File | Source file | Columns |
|---|---|---|
| `cbp23_us_naics23.csv` | https://www2.census.gov/programs-surveys/cbp/datasets/2023/cbp23us.zip (`cbp23us.txt`, file dated 2025-06-26), rows with `lfo="-"` (all legal forms) | `naics` (2017 NAICS), `emp` (paid employees, week incl. March 12), `est` (establishments), `n_lt5`, `n5_9`, `n10_19`, `n20_49`, `n50_99` (establishments by paid-employee size class) |
| `nes24_us_naics23.csv` | https://www2.census.gov/programs-surveys/nonemployer-statistics/datasets/2024/historical-datasets/nonemp24us.zip (`nonemp24us.txt`, file dated 2026-09-29) | `naics` (2022 NAICS), `lfo` (- all, C corp, Z S-corp, S sole prop, P partnership), `rcptot_size` (receipts size code, see below), `estab`, `rcptot_k` (receipts, $ thousands; only published for size 001) |
| `cbp23_state_raw.txt` | `cbp23st.zip` (same CBP 2023 folder) | `fipstate`, then for each NAICS in order 23----,236115,236118,236220,238110,238140,238160,238170,238210,238220,238310,238320,238330,238350,238390,238990 a pair `est|est_lt20` where est_lt20 = n<5 + n5_9 + n10_19. `NaN` = a size-class cell is suppressed (flag N) in the source. |
| `nes24_state_raw.txt` | `nonemp24st.zip` (same NES 2024 folder) | `st` (FIPS), then for NAICS 23, 2361, 2381, 23821, 23822, 2383, 2389 a pair `estab|rcptot_k` |

NES receipts size codes (from Census US record layout, https://www2.census.gov/programs-surveys/nonemployer-statistics/technical-documentation/record-layouts/us-record-layout/us_record_layout_2017.txt): 001 all; 111 <$5,000; 118 $5,000–9,999; 119 $10,000–24,999; 121 $25,000–49,999; 122 $50,000–99,999; 123 $100,000–249,999; 125 $250,000–499,999; 131 $500,000–999,999; 133 $1,000,000–2,499,999; 141 $2,500,000–4,999,999.

Granularity limit (verified from code list https://www2.census.gov/programs-surveys/nonemployer-statistics/technical-documentation/code-lists/nes_naics22.txt): NES publishes construction only at 23, 236, 2361, 2362, 237, 2371–2379, 238, 2381, 2382, 23821, 23822, 23829, 2383, 2389. There is no nonemployer count for roofing, siding, painting, concrete, drywall, etc. individually.

Row added for exterior cleaning: CBP `561790` (Other Services to Buildings and Dwellings, which includes pressure washing) and NES `56179`. This industry is outside NAICS 23.
