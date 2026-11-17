# Trade Profiles for Financial Command Center Presets (V3 addendum)

Prepared: 2026-11-17 · Agent 1 · Phase 0 research (no code)

## Ground rules (from the owner's V3 addendum)
- A preset changes only the UX: cards, quick actions, default reports, suggested cost codes, onboarding and help. **It never gates entitled features.** Every module stays reachable from "All Financial Tools".
- Switching trade never changes historical transactions. Projects can override the company preset.
- Admins can customize homepage cards. **Essential accounting alerts cannot be hidden:**
  - overdue AR;
  - bills past due;
  - overbilling above 100% of a line;
  - commitment overrun;
  - unreconciled or uncategorized items in the Needs Review queue;
  - expired sub documents on a bill being paid, when compliance is turned on.
- Reuse the existing Built2Bid trade taxonomy. Starter cost codes are suggestions mapped onto it, **not a second taxonomy**.

## Evidence base and labels
**[EV]** marks a statement backed by research in this folder:
- Commercial and GC work needs SOV pay apps, retainage, WIP and committed costs (`voc-report.md` §3.7–3.8; Sage docs in `qb-sage-capability-matrix.md`).
- Service and T&M work needs time-to-invoice and markup control (E125–E129, Sage T&M and Service Receivables).
- Change orders break QBO billing (E049–E052).
- Concrete and site work use unit-price billing and equipment costing (Sage unitary billing and Equipment module).

**[INF]** marks researcher inference from typical trade practice. I did not interview contractors, so every preset needs **customer validation interviews** before launch. Cost-code lists are starter sets loosely aligned to CSI divisions, which Sage also recommends for grouping ([Sage doc](https://docs.sage.com/docs/en/customer/100contractor/27_1US/open/Sage100ContractorandYourBusiness.pdf)). They are not a standard.

**Shared core for every preset.** These are always available and shown by default:
- invoices and payments;
- AR aging;
- job cost summary (budget vs committed vs actual vs billed);
- bills;
- the Needs Review queue;
- the cash snapshot.

**Card codes used below**
- **AR**: AR aging / overdue
- **CASH**: cash in and out, next 30 days
- **JOBM**: job margin (forecast vs estimate)
- **UNB**: unbilled work (costs and time not yet invoiced)
- **COP**: change orders pending signature or approval
- **RET**: retainage receivable / payable
- **WIP**: over/under billing
- **COMM**: committed vs remaining
- **BILLDUE**: pay apps / milestones due
- **UTIL**: technician utilization
- **HRS**: estimated vs actual hours
- **DEP**: deposits held / unapplied
- **COMP**: sub documents expiring
- **EQ**: equipment cost / usage

---

## 1. General Contractor (GC), residential and light commercial
- **Billing [EV/INF]:** deposit, then milestone or progress (% complete by SOV line). Cost-plus on some custom work. COs billed as SOV additions. Retainage on commercial and lender-funded jobs.
- **Labor [INF]:** mostly subs, plus a small employee crew (superintendent, carpenters).
- **Top 5 cards:** COMM · JOBM · BILLDUE · COP · RET
- **Quick actions:** Create pay app · Approve change order · Issue subcontract/PO · Enter sub bill against commitment · Record payment
- **Default reports:**
  - Job cost (budget/revised/committed/actual/ETC/forecast)
  - Committed cost by sub
  - Contract summary (original + approved COs)
  - Retainage aging (AR/AP)
  - WIP over/under
  - AR aging
- **Starter cost codes:** 01 General Conditions (permits, supervision, dumpsters) · 02 Site work/demo · 03 Concrete · 06 Framing/carpentry · 07 Roofing & insulation · 08 Doors & windows · 09 Finishes (drywall, paint, flooring) · 22 Plumbing · 23 HVAC · 26 Electrical · 31 Earthwork · Contingency · Fee/markup
- **Hide by default:** Equipment, Service tickets/utilization, Unit-price billing

## 2. Residential Remodeler
- **Billing [EV/INF]:** deposit, then milestone payment schedule from the proposal. COs are very frequent and must be signed before work (E049–E052 pain). Some T&M or allowance overages. Retainage is rare.
- **Labor [INF]:** both own crew and subs.
- **Top 5 cards:** COP · DEP · JOBM · UNB · AR
- **Quick actions:** Send change order for signature · Bill next milestone · Log receipt to job · Log time · Bill allowance overage
- **Default reports:**
  - Job profitability (estimate vs actual)
  - CO log
  - Allowance tracking (budget vs selections)
  - Deposits unapplied
  - Unbilled costs
  - AR aging
- **Starter cost codes:** Demo · Framing · Plumbing rough/finish · Electrical rough/finish · HVAC · Insulation · Drywall · Cabinets · Countertops · Tile · Flooring · Paint · Trim/finish carpentry · Fixtures/appliances (allowance) · Permits · Dumpster/cleanup
- **Hide by default:** Retainage, AIA-style pay app, WIP schedule (show if jobs over a threshold value), Equipment, Service utilization

## 3. Deck builder
- **Billing [INF]:** deposit (often 30–50%), then a material-delivery or framing milestone, then final. Short jobs with few COs.
- **Labor [INF]:** own small crew. Subs only occasionally.
- **Top 5 cards:** DEP · BILLDUE · JOBM · CASH · AR
- **Quick actions:** Collect deposit · Bill final · Log material receipt · Log crew hours · Send CO
- **Default reports:**
  - Job profitability
  - Material cost vs estimate
  - Deposits held
  - AR aging
  - Labor hours vs estimate
- **Starter cost codes:** Permits/engineering · Footings/concrete · Framing lumber · Decking material (wood/composite) · Railings · Stairs · Fasteners/hardware · Labor-framing · Labor-decking/railing · Disposal
- **Hide by default:** Retainage, AIA-style pay app, WIP, Subcontract commitments (simplified PO only), Equipment, Service

## 4. Roofing & Siding
- **Billing [INF]:** deposit or material draw, then completion invoice. Insurance-claim jobs bill in phases: ACV first, then RCV/depreciation release and supplements. Commercial roofing may carry retainage.
- **Labor [INF]:** often crews paid piece-rate per square, or subs.
- **Top 5 cards:** AR · BILLDUE · JOBM · COMM (crew/sub) · CASH
- **Quick actions:** Bill insurance supplement / depreciation release · Order materials (PO) · Enter crew/sub bill per square · Log receipt · Record payment
- **Default reports:**
  - Job profitability per square
  - Material cost vs estimate
  - Sub/crew payables
  - Insurance receivables (by carrier/claim)
  - AR aging
- **Starter cost codes:** Tear-off/disposal · Underlayment · Shingles/metal/membrane · Flashing · Gutters · Siding · Trim/soffit/fascia · Labor per square · Dumpster · Permits · Supplements
- **Hide by default:** WIP (show for commercial), AIA-style pay app (show for commercial), Equipment, Service utilization
- **Validation required:** insurance-claim billing flow. **No insurance-compliance claims.**

## 5. Electrical
- **Billing [EV/INF]:** service and small jobs billed T&M or flat rate. New construction billed by progress (SOV) with retainage when working as a sub to a GC.
- **Labor [INF]:** employees (licensed electricians, apprentices). Labor is the main cost.
- **Top 5 cards:** HRS · UNB · RET · JOBM · AR
- **Quick actions:** Log/approve time · Create T&M invoice · Create pay app (as sub) · Order materials (PO) · Record payment
- **Default reports:**
  - Labor hours/cost vs estimate by phase (rough, trim)
  - Job cost
  - Retainage receivable
  - Unbilled time & materials
  - AR aging
- **Starter cost codes:** Temp power · Rough-in labor · Rough-in material · Service/panel · Trim labor · Fixtures/devices · Low voltage · Permits/inspections · Change work
- **Hide by default:** Equipment, Subcontract commitments (simplified), Deposits card

## 6. Plumbing
- **Billing [EV/INF]:** service T&M or flat-rate. New construction progress billing with retainage as a sub (underground, rough, finish phases).
- **Labor [INF]:** employees.
- **Top 5 cards:** HRS · UNB · RET · JOBM · AR
- **Quick actions:** Log time · T&M invoice · Pay app by phase · PO materials · Record payment
- **Default reports:**
  - Job cost by phase
  - Labor vs estimate
  - Retainage
  - Unbilled
  - AR aging
- **Starter cost codes:** Underground · Rough-in · Top-out · Finish/trim · Fixtures · Water heater · Gas piping · Permits · Service call
- **Hide by default:** Equipment, Deposits, WIP (show for commercial)

## 7. HVAC
- **Billing [EV/INF]:** a high share of service, maintenance agreements and T&M. Equipment replacement is often a deposit plus completion. New construction progress billing with retainage.
- **Labor [INF]:** employees (technicians, installers).
- **Top 5 cards:** UTIL · UNB · AR · JOBM · BILLDUE
- **Quick actions:** Create service invoice from ticket/time · Log time · Bill install deposit · PO equipment · Record payment
- **Default reports:**
  - Technician utilization
  - Service profitability
  - Install job cost
  - Unbilled
  - AR aging
  - Retainage (commercial)
- **Starter cost codes:** Equipment (units) · Ductwork · Controls/thermostats · Refrigerant/materials · Install labor · Service labor · Startup/commissioning · Permits
- **Hide by default:** WIP (show for commercial), Subcontract commitments (simplified), Equipment directory (customer-installed equipment tracking is a P2 Sage-style item)

## 8. Concrete
- **Billing [EV/INF]:** unit-price (cubic yard / square foot) or lump-sum progress. Retainage is common as a sub to a GC (Sage supports unitary billing).
- **Labor [INF]:** employee crews. Equipment-heavy.
- **Top 5 cards:** RET · WIP · EQ · JOBM · BILLDUE
- **Quick actions:** Pay app with unit quantities · Log crew time · Log equipment usage · Enter ready-mix bill vs PO · Record payment
- **Default reports:**
  - Unit cost vs estimate (per CY/SF)
  - Job cost
  - Equipment cost allocation
  - Retainage aging
  - WIP over/under
- **Starter cost codes:** Excavation/grading · Forming · Rebar/mesh · Ready-mix · Pump · Placing/finishing labor · Saw cutting · Curing/sealing · Equipment · Testing
- **Hide by default:** Service utilization, Deposits card
- **Show by default:** Equipment (P1 for this trade)

## 9. Painting
- **Billing [INF]:** residential uses deposit + final. Commercial uses progress with retainage. Some unit/area pricing.
- **Labor [INF]:** employees or crews. Labor-dominant.
- **Top 5 cards:** HRS · JOBM · DEP · AR · BILLDUE
- **Quick actions:** Log crew time · Bill final · Log paint/material receipt · Send CO (extra coat or surfaces) · Record payment
- **Default reports:**
  - Labor hours vs estimate
  - Job profitability
  - Material cost vs estimate
  - AR aging
- **Starter cost codes:** Prep/masking · Interior walls · Ceilings · Trim/doors · Exterior body · Exterior trim · Paint/materials · Equipment rental (lift) · Cleanup
- **Hide by default:** Subcontract commitments, Retainage (show for commercial), WIP, Equipment

## 10. Exterior cleaning (pressure washing, soft wash, windows, gutters)
- **Billing [INF]:** per-visit flat price or per square foot. Recurring service plans. Paid on completion, often by card.
- **Labor [INF]:** small employee crews. Equipment and chemicals.
- **Top 5 cards:** CASH · AR · UTIL · EQ · JOBM (per visit)
- **Quick actions:** Invoice visit · Take payment on site · Log chemical/fuel receipt · Log hours · Schedule recurring invoice
- **Default reports:**
  - Revenue by service type
  - Profit per visit
  - Chemical/fuel cost
  - Crew utilization
  - AR aging
- **Starter cost codes:** House wash · Roof soft wash · Concrete/flatwork · Windows · Gutters · Chemicals · Fuel · Equipment maintenance · Travel
- **Hide by default:** Retainage, AIA-style pay app, WIP, Subcontract commitments, Change orders card

## 11. Drywall
- **Billing [EV/INF]:** commercial and tract work is progress billing by SOV (hang, tape, finish) with retainage, often unit-priced per board or square foot. Residential is deposit + final.
- **Labor [INF]:** crews, often piece-rate or subs.
- **Top 5 cards:** RET · BILLDUE · COMM · JOBM · HRS
- **Quick actions:** Pay app by phase % · Enter crew/sub bill · PO board/materials · Log time · Record payment
- **Default reports:**
  - Job cost by phase
  - Retainage aging
  - Committed sub/crew cost
  - Unit cost per SF
  - WIP
- **Starter cost codes:** Framing (metal stud) · Board material · Hang labor · Tape/finish labor · Texture · Insulation · Patch/repair · Scaffold/lift
- **Hide by default:** Service, Deposits, Equipment

## 12. Commercial contractor (GC or major sub)
- **Billing [EV]:** monthly AIA-style pay applications (SOV, % complete, stored materials). Retainage on AR and AP. Formal CO process. Owner/lender draws. WIP for bonding and CPA (Sage 6-1-7; QBO Advanced WIP; IES SOV/G702 beta).
- **Labor [INF]:** subs plus a field-management staff. Certified payroll is **out of scope** (exclude payroll).
- **Top 5 cards:** WIP · RET · COMM · BILLDUE · COMP
- **Quick actions:** Create monthly pay app · Approve CO (prime/sub) · Issue subcontract · Enter sub pay app/bill against commitment · Release retainage
- **Default reports:**
  - WIP over/under (bonding-ready export)
  - Contract summary
  - Committed cost & cost-to-complete
  - Retainage AR/AP aging
  - CO log
  - Sub compliance expirations
  - AR aging
- **Starter cost codes:** CSI divisions 01–33 (General Requirements through Utilities), with cost types Labor / Material / Subcontract / Equipment / Other (mirroring Sage's 5 predefined cost types)
- **Hide by default:** Deposits card, Service utilization
- **Turn on:** Sub compliance (optional module, on by default here)

## 13. Service contractor (generic repair and maintenance)
- **Billing [EV/INF]:** T&M or flat-rate per ticket. Maintenance agreements (recurring). Paid on completion. Sage pairs this with the Service Receivables add-on.
- **Labor [INF]:** employee technicians.
- **Top 5 cards:** UTIL · UNB · AR · CASH · JOBM (per ticket)
- **Quick actions:** Create ticket invoice from time & parts · Take payment · Log time · Log parts receipt · Create recurring agreement invoice
- **Default reports:**
  - Technician utilization (billable/available hours)
  - Revenue & margin by service type
  - Unbilled time
  - Agreement renewals
  - AR aging
- **Starter cost codes:** Service labor (regular/OT) · Trip/dispatch fee · Parts/materials · Diagnostic · Maintenance agreement · Warranty work (non-billable)
- **Hide by default:** Retainage, AIA-style pay app, WIP, Subcontract commitments, Change orders card

## 14. Other / Custom
Starts with the shared core cards: AR · CASH · JOBM · UNB · COP. There is no starter cost-code set beyond Labor / Material / Subcontract / Equipment / Other. Onboarding asks the V3 questions (project model, payment structure, labor model, inventory/equipment) and suggests the nearest preset.

---

## Cross-trade module visibility (defaults only; never entitlement)

| Module | Shown by default for | Hidden by default for |
|---|---|---|
| AIA-style pay app / SOV | GC, Commercial, Drywall, Concrete (+ Elec/Plumb/HVAC when job type = commercial) | Remodeler, Deck, Painting (res), Exterior cleaning, Service |
| Retainage | Commercial, GC, Concrete, Drywall, Elec/Plumb/HVAC (commercial jobs) | Deck, Exterior cleaning, Service, Remodeler |
| WIP schedule | Commercial, GC, Concrete, Drywall | Deck, Exterior cleaning, Service, Painting (res) |
| Subcontract commitments | GC, Commercial, Remodeler, Roofing, Drywall | Exterior cleaning, Service, Painting |
| T&M / ticket invoicing | Service, HVAC, Plumbing, Electrical, Exterior cleaning | Commercial (still available) |
| Unit-price billing | Concrete, Drywall, Exterior cleaning, Painting (commercial) | Remodeler, Deck |
| Equipment | Concrete, Exterior cleaning | All others |
| Sub compliance documents | Commercial, GC | All others (optional) |
| Utilization | Service, HVAC, Exterior cleaning | GC, Commercial |

## Validation required before launch
1. Interview at least 3 contractors per preset to confirm the billing structure and the top 5 cards.
2. Have a construction CPA review the WIP, retainage and cash-basis behavior.
3. Get legal review of "AIA-style" wording, insurance-claim billing language and compliance-document wording ("no verification claims").
4. Map starter cost codes onto the existing Built2Bid trade taxonomy (lead and code audit).
