// View model for the Growth OS Connections page. Pure (no I/O) so it is unit tested.
// Live statuses come only from the Growth OS database (growth_api.connections_overview). Without it the page
// shows the registry baselines, which are never working statuses, so nothing can look live by accident.
import { CONNECTORS, STATUSES, type Status } from "../../../growth-os/connectors/registry";

export const STATUS_LABEL: Record<Status, string> = {
  verified_operational: "Verified operational",
  limited: "Limited",
  awaiting_authorization: "Awaiting authorization",
  awaiting_platform_approval: "Awaiting platform approval",
  unsupported: "Unsupported",
};
export const STATUS_TONE: Record<Status, "green" | "amber" | "blue" | "violet" | "muted"> = {
  verified_operational: "green", limited: "amber", awaiting_authorization: "blue", awaiting_platform_approval: "violet", unsupported: "muted",
};

export interface OpView { key: string; label: string; status: Status; scopes: string[]; missing: string[]; privileged: boolean; phase: number; note?: string | null; reason?: string | null }
export interface CheckView { at: string; kind: string; outcome: string; httpStatus: number | null; missing: string[]; errorCode: string | null; message: string | null }
export interface CardView {
  provider: string; name: string; group: string; status: Status; simulated: boolean; accountRef: string | null; accountLabel: string | null;
  reason: string; lastError: string | null; lastVerifiedAt: string | null; lastCheckAt: string | null; expiresAt: string | null; refreshFails: number;
  grantedScopes: string[]; approvedPrivileged: string[]; operations: OpView[]; checks: CheckView[];
  authKinds: string[]; review: string; limits: string; cost: string; existing: string; manualSteps: string[]; manualSecrets: { name: string; what: string }[];
  docs: string[]; submission: { status: string; at: string; note?: string } | null; paused: boolean;
}
export interface ConnectionsView { source: "live" | "registry"; env: string | null; generatedAt: string | null; cards: CardView[]; alerts: { at: string; message: string; provider: string }[]; audit: { at: string; actor: string; action: string; detail: Record<string, unknown> | null }[]; counts: Record<Status, number> }

const asStatus = (s: unknown): Status => (STATUSES as readonly string[]).includes(String(s)) ? (s as Status) : "unsupported";
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON from growth_api.connections_overview
export function buildView(overview: any | null): ConnectionsView {
  const registry = new Map(CONNECTORS.map((c) => [c.provider, c]));
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<Status, number>;
  if (!overview) {
    const cards: CardView[] = CONNECTORS.map((c) => ({
      provider: c.provider, name: c.name, group: c.group, status: c.baseline, simulated: false, accountRef: null, accountLabel: null,
      reason: c.baselineReason, lastError: null, lastVerifiedAt: null, lastCheckAt: null, expiresAt: null, refreshFails: 0, grantedScopes: [], approvedPrivileged: [],
      operations: c.operations.map((o) => ({ key: o.key, label: o.label, status: c.baseline === "unsupported" ? "unsupported" : o.baseline, scopes: o.scopes, missing: o.scopes, privileged: o.privileged, phase: o.phase, note: o.note, reason: null })),
      checks: [], authKinds: c.authKinds, review: c.review, limits: c.limits, cost: c.cost, existing: c.existing, manualSteps: c.manualSteps,
      manualSecrets: c.manualSecrets ?? [], docs: c.docs, submission: null, paused: false,
    }));
    cards.forEach((c) => counts[c.status]++);
    return { source: "registry", env: null, generatedAt: null, cards, alerts: [], audit: [], counts };
  }
  const paused = new Set(arr(overview.paused_connectors));
  const cards: CardView[] = (overview.connectors ?? []).map((s: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const reg = registry.get(s.provider);
    const k = s.connector ?? {};
    const simulated = Boolean(s.is_simulated);
    let status = asStatus(s.status);
    if (simulated && status === "verified_operational") status = "limited";   // belt and braces: the DB already forbids it
    return {
      provider: s.provider, name: s.name ?? reg?.name ?? s.provider, group: s.grp ?? reg?.group ?? "", status, simulated,
      accountRef: s.account_ref ?? null, accountLabel: s.account_label ?? null, reason: s.baseline_reason ?? reg?.baselineReason ?? "",
      lastError: s.last_error ?? null, lastVerifiedAt: s.last_verified_at ?? null, lastCheckAt: s.last_check_at ?? null, expiresAt: s.expires_at ?? null,
      refreshFails: Number(s.refresh_fail_count ?? 0), grantedScopes: arr(s.granted_scopes), approvedPrivileged: arr(s.approved_privileged_scopes),
      operations: (s.operations ?? []).map((o: any) => ({ key: o.op_key, label: o.label, status: simulated && o.status === "verified_operational" ? "limited" : asStatus(o.status), // eslint-disable-line @typescript-eslint/no-explicit-any
        scopes: arr(o.scopes), missing: arr(o.missing_scopes), privileged: Boolean(o.privileged), phase: Number(o.phase), note: o.note ?? null, reason: o.reason ?? null })),
      checks: (s.checks ?? []).map((x: any) => ({ at: x.at, kind: x.kind, outcome: x.outcome, httpStatus: x.http_status ?? null, missing: arr(x.missing_scopes), // eslint-disable-line @typescript-eslint/no-explicit-any
        errorCode: x.error_code ?? null, message: x.message ?? null })),
      authKinds: arr(k.auth_kinds ?? reg?.authKinds), review: k.review ?? reg?.review ?? "", limits: k.limits ?? reg?.limits ?? "", cost: k.cost ?? reg?.cost ?? "",
      existing: k.existing ?? reg?.existing ?? "", manualSteps: arr(k.manual_steps ?? reg?.manualSteps), manualSecrets: reg?.manualSecrets ?? [],
      docs: arr(k.docs ?? reg?.docs), submission: s.platform_submission ?? null, paused: paused.has(s.provider),
    };
  });
  cards.forEach((c) => counts[c.status]++);
  const audit = (overview.audit ?? []) as ConnectionsView["audit"];
  const alerts = audit.filter((a) => a.action === "connector_alert").map((a) => ({ at: a.at, provider: String(a.detail?.provider ?? ""), message: String(a.detail?.message ?? "") }));
  return { source: "live", env: overview.env ?? null, generatedAt: overview.generated_at ?? null, cards, alerts, audit, counts };
}
