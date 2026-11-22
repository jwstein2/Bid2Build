/**
 * Builds the Start Your Contracting Business guide for one state and trade (pure; pages and tests share it).
 * Only facts whose quote was re-found on the official page ("verified") show our plain-language summary. Anything
 * else is shown as "still being confirmed" with the official link, never as a fact.
 */
import { CREDENTIAL_LABEL, needsFor } from "./trades";
import type { Credential, CredentialKey, FederalFact, FederalFile, GeneralFact, OtherCredential, StateFile } from "./types";

export interface GuideFact {
  id: string;
  title: string;
  agency: string | null;
  verified: boolean;
  summary: string | null; // null unless verified
  details: { label: string; value: string }[];
  url: string | null;
  when?: string | null;
}

export interface GuideStep { id: string; title: string; intro: string; facts: GuideFact[] }

export interface Prerequisite { id: string; title: string; agency: string | null; items: string[]; url: string | null; when?: string | null; verified: boolean }

export interface Guide {
  state: string;
  trade: string | null;
  checkedAt: string;
  prerequisites: Prerequisite[];
  steps: GuideStep[];
  /** Categories that matter for the trade but the state doesn't license (cities or counties may). */
  noStateLicense: GuideFact[];
  /** Categories still being confirmed for this state. */
  unconfirmed: { key: CredentialKey; title: string }[];
  /** True when a credential the trade always needs hasn't been confirmed for this state. */
  coreUnconfirmed: boolean;
  counts: { verified: number; pending: number };
}

const LICENSED = new Set(["state_license", "state_registration", "threshold"]);
const ok = (f: { status_check: string } | null | undefined) => f?.status_check === "verified";

function credentialFact(key: CredentialKey, c: Credential, when?: string): GuideFact {
  const v = ok(c);
  const details: GuideFact["details"] = [];
  if (v) {
    if (c.covers) details.push({ label: "Who needs it", value: c.covers });
    if (c.threshold) details.push({ label: "Threshold", value: c.threshold });
    if (c.bond) details.push({ label: "Bond", value: c.bond });
    if (c.insurance) details.push({ label: "Insurance", value: c.insurance });
  }
  return { id: `cred-${key}`, title: v && c.name ? c.name : CREDENTIAL_LABEL[key], agency: c.agency ?? null, verified: v, summary: v ? c.summary : null, details, url: c.url ?? null, when: when ?? null };
}

function generalFact(id: string, title: string, g: GeneralFact | undefined): GuideFact | null {
  if (!g) return null;
  const v = ok(g);
  return { id, title, agency: g.agency, verified: v, summary: v ? g.summary : null, details: [], url: g.url };
}

function federalFact(f: FederalFact | undefined): GuideFact | null {
  if (!f) return null;
  const v = ok(f);
  return { id: `us-${f.key}`, title: f.name ?? f.key, agency: f.agency, verified: v, summary: v ? f.summary : null, details: [], url: f.link ?? f.url, when: f.when };
}

function otherFact(o: OtherCredential): GuideFact {
  const v = ok(o);
  return { id: `other-${o.key}`, title: o.name ?? o.key, agency: o.agency, verified: v, summary: v ? o.summary : null, details: [], url: o.url };
}

const forTrade = (trades: string[], trade: string | null) => trades.includes("*") || (trade !== null && trades.includes(trade));

export function buildGuide(file: StateFile, federal: FederalFile, trade: string | null): Guide {
  const needs = needsFor(trade);
  const fed = (key: string) => federal.facts.find((f) => f.key === key);
  const cred = (k: CredentialKey) => file.credentials[k];

  // Prerequisites: what has to be in hand before applying or starting, core credentials first.
  const prerequisites: Prerequisite[] = [];
  for (const k of needs.core) {
    const c = cred(k);
    if (!c || !LICENSED.has(c.status)) continue;
    const v = ok(c);
    const items = v ? [...(c.prerequisites ?? [])] : [];
    // Bond and insurance often already appear in the prerequisites; add them only when they don't.
    if (v && c.bond && !items.some((i) => /bond/i.test(i))) items.push(`Bond: ${c.bond}`);
    if (v && c.insurance && !items.some((i) => /insur/i.test(i))) items.push(`Insurance: ${c.insurance}`);
    prerequisites.push({ id: `pre-${k}`, title: v && c.name ? c.name : CREDENTIAL_LABEL[k], agency: c.agency ?? null, items, url: c.url ?? null, verified: v });
  }
  for (const f of federal.facts) {
    if (!f.when || !forTrade(f.trades, trade) || f.key === "usdot" || f.key === "worker_classification") continue;
    const v = ok(f);
    prerequisites.push({ id: `pre-us-${f.key}`, title: f.name ?? f.key, agency: f.agency, items: v && f.summary ? [f.summary] : [], url: f.link ?? f.url, when: f.when, verified: v });
  }

  const licenseFacts: GuideFact[] = [];
  const noStateLicense: GuideFact[] = [];
  const unconfirmed: Guide["unconfirmed"] = [];
  const seen = new Set<CredentialKey>();
  const place = (k: CredentialKey, when?: string) => {
    if (seen.has(k)) return;
    seen.add(k);
    const c = cred(k);
    if (!c || c.status === "unknown") { unconfirmed.push({ key: k, title: CREDENTIAL_LABEL[k] }); return; }
    if (LICENSED.has(c.status)) licenseFacts.push(credentialFact(k, c, when));
    else noStateLicense.push(credentialFact(k, c, when));
  };
  needs.core.forEach((k) => place(k));
  needs.ifYou.forEach((x) => place(x.key, x.when));
  const others = file.other.filter((o) => trade !== null && o.trades.includes(trade)).map(otherFact);

  const steps: GuideStep[] = [
    { id: "structure", title: "Pick your business structure and register it", intro: "Decide how the business is set up, then file it with the state so you can use your business name.",
      facts: [federalFact(fed("structure")), generalFact("entity", "Register your business with the state", file.general.entity)].filter(Boolean) as GuideFact[] },
    { id: "taxes", title: "Get your tax numbers", intro: "A federal EIN first, then your state tax accounts.",
      facts: [federalFact(fed("ein")), generalFact("state_tax", "Register for state taxes", file.general.state_tax)].filter(Boolean) as GuideFact[] },
    { id: "licenses", title: "Get your state license", intro: licenseFacts.length ? "Apply once you meet the requirements listed above."
        : needs.core.some((k) => unconfirmed.some((u) => u.key === k)) ? "We haven't confirmed yet whether the state licenses this work. Check the state licensing agency before you start."
        : "Based on what we've confirmed, the state doesn't license this work. Cities and counties still may.",
      facts: [...licenseFacts, ...others] },
    { id: "local", title: "Check your city and county", intro: "Many cities and counties have their own contractor licenses or registrations, and permits are pulled locally.",
      facts: [generalFact("local", "Local licenses and permits", file.general.local), ...noStateLicense.filter((f) => !f.when)].filter(Boolean) as GuideFact[] },
    { id: "insurance", title: "Get insured", intro: "Line up liability insurance before your first job. Workers' comp rules depend on whether you have employees.",
      facts: [generalFact("workers_comp", "Workers' compensation", file.general.workers_comp)].filter(Boolean) as GuideFact[] },
    { id: "hiring", title: "Before you hire anyone", intro: "Decide whether helpers are employees or contractors, then open your state accounts for employers.",
      facts: [federalFact(fed("worker_classification")), generalFact("unemployment", "Unemployment insurance account", file.general.unemployment)].filter(Boolean) as GuideFact[] },
    { id: "vehicles", title: "Trucks and trailers", intro: "Heavier trucks and trailers can bring federal and state vehicle rules.",
      facts: [federalFact(fed("usdot"))].filter(Boolean) as GuideFact[] },
  ];

  const all: { status_check: string }[] = [...Object.values(file.general).filter(Boolean) as GeneralFact[], ...Object.values(file.credentials), ...file.other];
  return {
    state: file.state, trade, checkedAt: file.checked_at, prerequisites, steps, noStateLicense, unconfirmed,
    coreUnconfirmed: needs.core.some((k) => unconfirmed.some((u) => u.key === k)),
    counts: { verified: all.filter((f) => f.status_check === "verified").length, pending: all.filter((f) => f.status_check !== "verified").length },
  };
}
