"use client";
/**
 * Manage Access (V6.7): one employee's workspace and feature access. Four collapsible workspaces with a master
 * switch, one row per feature with only the levels that mean something for it, role templates, Reset to Role
 * Defaults, a review of changes, and Preview Employee Experience (read-only: computed from the draft, it never
 * signs in as the person or runs anything as them).
 *
 * The draft is a permission set. Saving sends the same granted/revoked arrays the older editor sends (plus the
 * profile), and the database re-checks every rule.
 */
import { ChevronDown, Eye, History, Loader2, Lock, RotateCcw, Search, ShieldAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState } from "react";
import { Button } from "../ui/button";
import { Badge } from "../ui/misc";
import { ROLE_LABELS, type CompanyRole } from "@/lib/enterprise/permissions";
import { FIN_PERMISSION_KEYS, FIN_ROLE_LABELS, type FinRole } from "@/lib/financials/permissions";
import {
  FEATURES, FEATURE_BY_ID, NONE, WORKSPACES, WORKSPACE_INFO, levelFromPerms, levelLabel, permsForLevel,
  type Feature, type FeatureId, type LevelKey, type License, type SectionId, type WorkspaceId,
} from "@/lib/access/capabilities";
import {
  ACCESS_PROFILE_VERSION, ROLE_TEMPLATES, TEMPLATE_BY_ID, applyTemplate, compilePerms, memberPermSet, resolveAccess, roleDefaults, setLevel, setLevelWithDeps,
  type AccessPolicy, type AccessProfile, type EffectiveAccess,
} from "@/lib/access/effective";
import { buildNav } from "@/lib/access/nav";
import { ACTIONS, type SearchCaps } from "@/lib/search/actions";

export interface AccessMember {
  userId: string; name: string; role: CompanyRole;
  granted: string[]; revoked: string[]; policyRevoked: string[]; profile: AccessProfile | null;
  pmEditor: boolean; pmEditorAssigned: boolean; finRole: FinRole | null; finCovered: boolean; finAccountantSeat: boolean;
}
export interface AccessLicenses { pm: boolean; pmEditorLimit: number; pmEditorsAssigned: number; financials: boolean }

type Props = {
  member: AccessMember; licenses: AccessLicenses; policy: AccessPolicy; premium: boolean;
  actor: { isOwner: boolean; perms: string[] }; flags: { pm: boolean; financials: boolean };
  onClose: () => void;
};

const FIN = new Set<string>(FIN_PERMISSION_KEYS);
const ROLES: Exclude<CompanyRole, "owner">[] = ["manager", "estimator", "viewer"];
const STATE_TONE = { full: "ok", limited: "accent", off: "neutral" } as const;
const STATE_LABEL = { full: "Enabled", limited: "Limited", off: "Disabled" } as const;
const LICENSE_WHY: Record<License, string> = {
  pm: "Needs Project Command Center on your plan.",
  pm_editor: "Needs a scheduling editor seat. Assign one under Scheduling editor seats below; turning this on never buys one.",
  financials: "Needs the Financial Command Center and a financial seat for this person (Financials → Team).",
  premium: "Needs Premium (included with Team).",
};

/** The access this draft gives the employee (same resolver the app uses for the real person). */
function draftAccess(member: AccessMember, role: CompanyRole, perms: Set<string>, profile: AccessProfile, licenses: AccessLicenses, policy: AccessPolicy, premium: boolean, flags: Props["flags"]): EffectiveAccess {
  const finSeat = Boolean(member.finRole && member.finCovered && licenses.financials && flags.financials);
  return resolveAccess({
    company: { id: "preview", name: "", role, isOwner: false, perms: [...perms].filter((p) => !FIN.has(p) && !policy.denied.includes(p)), profile, policy,
      revoked: compilePerms(role, perms, member.finRole).revoked },
    finPerms: finSeat ? [...perms].filter((p) => FIN.has(p) && !policy.denied.includes(p)) : null,
    licenses: { pm: flags.pm && licenses.pm, pmEditor: member.pmEditor, financials: finSeat, premium },
  });
}

export function AccessEditor({ member, licenses, policy, premium, actor, flags, onClose }: Props) {
  const router = useRouter();
  const id = useId();
  const initialRole = (member.role === "owner" ? "manager" : member.role) as Exclude<CompanyRole, "owner">;
  // What the person holds now; policy restrictions are shown as such, not as the admin's choice.
  const initialPerms = useMemo(() => memberPermSet(member.role, member.granted, member.revoked.filter((k) => !member.policyRevoked.includes(k)), member.finRole), [member]);
  const initialProfile: AccessProfile = useMemo(() => ({
    v: ACCESS_PROFILE_VERSION, template: member.profile?.template ?? null,
    workspaces: Object.fromEntries(WORKSPACES.map((w) => [w, member.profile?.workspaces?.[w] !== false])),
    app: { ...(member.profile?.app ?? {}) },
  }), [member]);
  const [role, setRole] = useState(initialRole);
  const [perms, setPerms] = useState<Set<string>>(initialPerms);
  const [profile, setProfile] = useState<AccessProfile>(initialProfile);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Record<SectionId, boolean>>({ win: true, run: false, grow: false, financials: false, admin: false });
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState(false);
  const [review, setReview] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const access = useMemo(() => draftAccess(member, role, perms, profile, licenses, policy, premium, flags), [member, role, perms, profile, licenses, policy, premium, flags]);
  const before = useMemo(() => draftAccess(member, initialRole, initialPerms, initialProfile, licenses, policy, premium, flags), [member, initialRole, initialPerms, initialProfile, licenses, policy, premium, flags]);

  const levelOf = (f: Feature): LevelKey => f.appGated ? (profile.app?.[f.id as FeatureId] === "none" ? NONE : profile.workspaces?.[f.section as WorkspaceId] === false && !profile.app?.[f.id as FeatureId] ? NONE : f.options[0].key) : levelFromPerms(f, perms);
  const initialLevelOf = (f: Feature): LevelKey => f.appGated ? (initialProfile.app?.[f.id as FeatureId] === "none" ? NONE : initialProfile.workspaces?.[f.section as WorkspaceId] === false && !initialProfile.app?.[f.id as FeatureId] ? NONE : f.options[0].key) : levelFromPerms(f, initialPerms);
  const locked = (f: Feature) => !actor.isOwner && f.options.some((o) => o.perms.some((p) => policy.locked.includes(p)));
  const restricted = (f: Feature) => f.options.length > 0 && f.options.every((o) => o.perms.length > 0 && o.perms.every((p) => policy.denied.includes(p)));
  /** May the actor move this feature to `level`? Delegated admins only add what they hold (or the person already had). */
  const canSet = (f: Feature, level: LevelKey) => {
    if (f.ownerOnly && !actor.isOwner) return false;
    if (locked(f)) return false;
    if (actor.isOwner) return true;
    return permsForLevel(f, level).every((p) => actor.perms.includes(p) || initialPerms.has(p));
  };

  function setFeature(fid: FeatureId, level: LevelKey) {
    const r = setLevelWithDeps(perms, fid, level, profile.app ?? {});
    setPerms(r.perms);
    setProfile({ ...profile, template: null, app: r.app });
    setNotes(r.also.length ? { [fid]: `Also changed: ${r.also.map((x) => FEATURE_BY_ID[x].label).join(", ")} (needed together).` } : {});
  }
  function setWorkspace(ws: WorkspaceId, on: boolean) {
    let next = new Set(perms);
    const app = { ...(profile.app ?? {}) };
    const defaults = roleDefaults(role, member.finRole).perms;
    for (const f of FEATURES.filter((x) => x.section === ws) as Feature[]) {
      if (locked(f)) continue;
      if (f.appGated) { delete app[f.id as FeatureId]; continue; }
      // Off: every feature to No access. On: back to the role's defaults (or what they had, if you can't grant more).
      const want = on ? levelFromPerms(f, defaults) : NONE;
      const target = canSet(f, want) ? want : initialLevelOf(f);
      next = setLevel(next, f.id as FeatureId, on ? target : NONE);
    }
    setPerms(next);
    setProfile({ ...profile, template: null, workspaces: { ...profile.workspaces, [ws]: on }, app });
    setOpen({ ...open, [ws]: true });
    setNotes({});
  }
  function applyTpl(tid: string) {
    const t = TEMPLATE_BY_ID[tid];
    if (!t) return;
    const r = applyTemplate(t, member.finRole);
    // Keep locked / owner-only features as they are for delegated admins.
    let next = r.perms;
    for (const f of FEATURES as readonly Feature[]) if (!canSet(f, levelFromPerms(f, next))) {
      for (const o of f.options) for (const p of o.perms) next.delete(p);
      for (const p of permsForLevel(f, levelFromPerms(f, initialPerms))) next.add(p);
    }
    next = new Set(next);
    setRole(t.role); setPerms(next); setProfile(r.profile); setNotes({});
  }
  function resetDefaults() {
    const r = roleDefaults(role, member.finRole);
    setPerms(r.perms); setProfile(r.profile); setNotes({});
  }

  const changes = (FEATURES as readonly Feature[]).filter((f) => levelOf(f) !== initialLevelOf(f));
  const wsChanges = WORKSPACES.filter((w) => (profile.workspaces?.[w] !== false) !== (initialProfile.workspaces?.[w] !== false));
  const dirty = role !== initialRole || changes.length > 0 || wsChanges.length > 0;

  async function save() {
    setBusy(true); setMsg(null);
    const { granted, revoked } = compilePerms(role, perms, member.finRole, policy.denied);
    const r = await fetch("/api/company/access", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "save", userId: member.userId, role, granted, revoked, profile, reason: reason || undefined }) }).catch(() => null);
    const d = await r?.json().catch(() => null);
    setBusy(false);
    if (!r?.ok) { setMsg({ ok: false, text: d?.error?.message ?? "Couldn't save. Nothing was changed; please try again." }); return; }
    setMsg({ ok: true, text: "Access saved. It applies on their next page load." });
    setReview(false); setReason("");
    router.refresh();
  }

  const q = query.trim().toLowerCase();
  const match = (f: Feature) => !q || `${f.label} ${f.description} ${f.options.map((o) => o.label).join(" ")}`.toLowerCase().includes(q);

  const row = (f: Feature) => {
    const fid = f.id as FeatureId;
    const lvl = levelOf(f);
    const eff = access.features[fid];
    const isLocked = locked(f);
    const isRestricted = restricted(f);
    const opts = [NONE, ...f.options.map((o) => o.key)];
    return (
      <li key={fid} className="grid gap-2 py-3 sm:grid-cols-[1fr_minmax(12rem,15rem)] sm:items-center" data-testid={`access-row-${fid}`}>
        <div className="min-w-0">
          <label htmlFor={`${id}-${fid}`} className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
            {f.label}
            {isLocked && <Badge tone="warn"><Lock className="h-3 w-3" aria-hidden />Locked by owner</Badge>}
            {isRestricted && <Badge tone="danger">Restricted company-wide</Badge>}
            {eff.exception && <Badge tone="accent">Kept while workspace is off</Badge>}
          </label>
          <p className="text-xs text-ink-soft">{f.description}</p>
          {eff.blocked && eff.blocked !== "policy" && lvl !== NONE && <p className="mt-1 text-xs text-warn" data-testid={`access-why-${fid}`}>Granted, but not active yet: {LICENSE_WHY[eff.blocked]}</p>}
          {f.scopeNote && <p className="mt-1 text-xs text-muted">{f.scopeNote}</p>}
          {notes[fid] && <p className="mt-1 text-xs text-accent-ink" role="status">{notes[fid]}</p>}
        </div>
        <select id={`${id}-${fid}`} value={lvl} disabled={isLocked || isRestricted || (f.ownerOnly && !actor.isOwner)} onChange={(e) => setFeature(fid, e.target.value)}
          className="h-11 w-full rounded-lg border border-line bg-surface px-2 text-base disabled:opacity-60" data-testid={`access-level-${fid}`}>
          {opts.map((k) => <option key={k} value={k} disabled={k !== lvl && !canSet(f, k)}>{levelLabel(f, k)}{k !== NONE && f.options.find((o) => o.key === k)?.license === "pm_editor" ? " (editor seat)" : ""}</option>)}
        </select>
      </li>
    );
  };

  const section = (s: SectionId) => {
    const list = (FEATURES as readonly Feature[]).filter((f) => f.section === s && match(f));
    if (!list.length) return null;
    const isWs = s !== "admin";
    const w = isWs ? access.workspaces[s as WorkspaceId] : null;
    const on = isWs ? profile.workspaces?.[s as WorkspaceId] !== false : true;
    const expanded = open[s] || Boolean(q);
    return (
      <section key={s} className="rounded-lg border border-line bg-surface" data-testid={`access-ws-${s}`}>
        <div className="flex flex-wrap items-center gap-2 px-3 py-2">
          <button type="button" onClick={() => setOpen({ ...open, [s]: !open[s] })} aria-expanded={expanded} aria-controls={`${id}-${s}-body`}
            className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left">
            <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${expanded ? "" : "-rotate-90"}`} aria-hidden />
            <span className="min-w-0">
              <span className="block font-display font-bold">{WORKSPACE_INFO[s].label}</span>
              <span className="block text-xs text-ink-soft">{WORKSPACE_INFO[s].blurb}</span>
            </span>
          </button>
          {w && <Badge tone={STATE_TONE[w.state]}>{STATE_LABEL[w.state]}{w.exceptions.length > 0 && ` · ${w.exceptions.length} kept`}</Badge>}
          {isWs && (
            <button type="button" role="switch" aria-checked={on} aria-label={`${WORKSPACE_INFO[s].label} workspace`} onClick={() => setWorkspace(s as WorkspaceId, !on)} data-testid={`access-master-${s}`}
              className={`relative inline-flex h-8 w-14 shrink-0 items-center rounded-full transition-colors ${on ? "bg-brand" : "bg-line-strong"}`}>
              <span className={`inline-block h-6 w-6 rounded-full bg-white shadow transition-transform ${on ? "translate-x-7" : "translate-x-1"}`} />
            </button>
          )}
        </div>
        {expanded && (
          <div id={`${id}-${s}-body`} className="border-t border-line px-3">
            {isWs && !on && <p className="pt-2 text-xs text-ink-soft">This workspace is off: its menu, dashboard widgets, shortcuts and search results are hidden. You can still keep a specific feature on below; it shows under &quot;Other access&quot; in their menu.</p>}
            {s === "financials" && !member.finRole && <p className="pt-2 text-xs text-warn">No financial seat yet: Financials stays hidden until one is assigned on Financials → Team. Settings saved here apply once it is.</p>}
            {s === "financials" && member.finRole && <p className="pt-2 text-xs text-ink-soft">Financial seat: {FIN_ROLE_LABELS[member.finRole]}{member.finAccountantSeat ? " (free read-only accountant seat)" : member.finCovered ? "" : " (not covered by your plan right now)"}. Role defaults below include that seat&apos;s preset.</p>}
            {s === "admin" && !actor.isOwner && <p className="pt-2 text-xs text-ink-soft">Only the primary account holder can change these.</p>}
            <ul className="divide-y divide-line">{list.map(row)}</ul>
          </div>
        )}
      </section>
    );
  };

  return (
    <div className="space-y-3" data-testid="access-editor">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor={`${id}-role`} className="text-sm font-semibold">Role</label>
          <select id={`${id}-role`} value={role} onChange={(e) => { const r = e.target.value as typeof role; setRole(r); const d = roleDefaults(r, member.finRole); setPerms(d.perms); setProfile(d.profile); }}
            className="mt-1 block h-11 w-full min-w-44 rounded-lg border border-line bg-surface px-2 text-base" data-testid="access-role">
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-tpl`} className="text-sm font-semibold">Apply role template</label>
          <select id={`${id}-tpl`} value={profile.template ?? ""} onChange={(e) => applyTpl(e.target.value)} className="mt-1 block h-11 w-full min-w-52 rounded-lg border border-line bg-surface px-2 text-base" data-testid="access-template">
            <option value="">{profile.template ? "Custom" : "Choose a starting point…"}</option>
            {ROLE_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={resetDefaults} data-testid="access-reset"><RotateCcw className="h-4 w-4" aria-hidden />Reset to role defaults</Button>
      </div>
      {profile.template && <p className="text-xs text-ink-soft">{TEMPLATE_BY_ID[profile.template]?.blurb} Templates are starting points: change anything below.</p>}
      <p className="text-xs text-ink-soft"><b>Visibility vs. authorization:</b> turning something off hides it from their menu, dashboard and search <i>and</i> blocks it on the server. Turning something on only works within your plan, their seats and the records they&apos;re allowed to see (for example, their own or assigned projects).</p>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
        <label htmlFor={`${id}-q`} className="sr-only">Search permissions</label>
        <input id={`${id}-q`} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search permissions (e.g. invoices, schedule)" className="h-11 w-full rounded-lg border border-line bg-surface pl-9 pr-3 text-base" data-testid="access-search" />
      </div>

      {(["win", "run", "grow", "financials", "admin"] as SectionId[]).map(section)}

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={() => setPreview(!preview)} aria-expanded={preview} data-testid="access-preview-toggle"><Eye className="h-4 w-4" aria-hidden />Preview Employee Experience</Button>
        <HistoryButton userId={member.userId} />
      </div>
      {preview && <Preview name={member.name} access={access} perms={perms} premium={premium} flags={flags} finSeat={Boolean(member.finRole && member.finCovered)} />}

      {review && dirty && (
        <div className="rounded-lg border border-line-strong bg-paper p-3" data-testid="access-review" role="region" aria-label="Review changes">
          <p className="font-semibold">Review changes for {member.name}</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
            {role !== initialRole && <li>Role: {ROLE_LABELS[initialRole]} → {ROLE_LABELS[role]}</li>}
            {wsChanges.map((w) => <li key={w}>{WORKSPACE_INFO[w].label}: {profile.workspaces?.[w] === false ? "turned off" : "turned on"}</li>)}
            {changes.map((f) => <li key={f.id}>{f.label}: {levelLabel(f, initialLevelOf(f))} → {levelLabel(f, levelOf(f))}</li>)}
          </ul>
          <p className="mt-2 text-xs text-ink-soft">Workspaces after saving: {WORKSPACES.map((w) => `${WORKSPACE_INFO[w].label} ${STATE_LABEL[access.workspaces[w].state].toLowerCase()} (was ${STATE_LABEL[before.workspaces[w].state].toLowerCase()})`).join(" · ")}. Seats and billing don&apos;t change.</p>
          <label htmlFor={`${id}-reason`} className="mt-2 block text-sm font-semibold">Reason (optional, kept in the change history)</label>
          <input id={`${id}-reason`} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} className="mt-1 h-11 w-full rounded-lg border border-line bg-surface px-3 text-base" data-testid="access-reason" />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        {!review ? (
          <Button type="button" onClick={() => setReview(true)} disabled={!dirty} data-testid="access-review-btn">Review changes</Button>
        ) : (
          <Button type="button" onClick={save} disabled={busy || !dirty} data-testid="access-save">{busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}Save Access</Button>
        )}
        <Button type="button" variant="secondary" onClick={() => { if (review) setReview(false); else onClose(); }}>Cancel</Button>
        {!dirty && <span className="text-xs text-ink-soft">No changes yet.</span>}
      </div>
      {msg && <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-ok" : "text-danger"}`} data-testid="access-msg">{msg.text}</p>}
    </div>
  );
}

/** Read-only: what this person's menu, dashboard and quick actions would contain. */
function Preview({ name, access, perms, premium, flags, finSeat }: { name: string; access: EffectiveAccess; perms: Set<string>; premium: boolean; flags: Props["flags"]; finSeat: boolean }) {
  const nav = buildNav(access);
  const caps: SearchCaps = {
    premium, admin: false, flags,
    company: { id: "preview", role: access.company?.role ?? "viewer", perms: [...perms].filter((p) => !FIN.has(p)) },
    fin: finSeat && flags.financials ? { book: "preview", sandbox: false, perms: [...perms].filter((p) => FIN.has(p)) } : null,
  };
  const actions = ACTIONS.filter((a) => !a.comingSoon && a.allowed(caps) && actionVisible(access, a.href)).slice(0, 12);
  const dash = WORKSPACES.filter((w) => access.workspaces[w].visible);
  return (
    <div className="rounded-lg border border-accent/40 bg-accent-tint/40 p-3" data-testid="access-preview" role="region" aria-label={`Preview of ${name}'s experience`}>
      <p className="flex items-center gap-1.5 font-semibold"><Eye className="h-4 w-4" aria-hidden />What {name} will see</p>
      <p className="text-xs text-ink-soft">A read-only preview from these settings. It doesn&apos;t sign in as them or run anything as them.</p>
      <div className="mt-2 grid gap-3 sm:grid-cols-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-muted">Menu</p>
          {nav.length === 0 && <p className="text-sm">Home, Account and Help only.</p>}
          {nav.map((g) => (
            <div key={g.id} className="mt-1">
              <p className="text-sm font-semibold">{g.label}</p>
              <ul className="text-sm text-ink-soft">{g.items.map((i) => <li key={`${i.href}-${i.feature}`}>{i.label}{i.needs && <span className="text-xs text-warn"> (needs {i.needs === "pm_editor" ? "editor seat" : i.needs === "financials" ? "financial seat" : "plan"})</span>}</li>)}</ul>
            </div>
          ))}
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-muted">Dashboard sections</p>
          {dash.length === 0 ? <p className="text-sm">No workspace widgets.</p> : <ul className="text-sm text-ink-soft">{dash.map((w) => <li key={w}>{WORKSPACE_INFO[w].label} ({STATE_LABEL[access.workspaces[w].state].toLowerCase()})</li>)}</ul>}
          {!access.features.fin_visibility || access.features.fin_visibility.level !== "company" ? <p className="mt-1 text-xs text-ink-soft">No bank balance, payroll or company P&amp;L widgets.</p> : null}
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-muted">Quick actions</p>
          {actions.length === 0 ? <p className="text-sm">None.</p> : <ul className="text-sm text-ink-soft">{actions.map((a) => <li key={a.id}>{a.label}</li>)}</ul>}
        </div>
      </div>
    </div>
  );
}

/** An action is offered only when the feature its page belongs to is on. */
function actionVisible(access: EffectiveAccess, href: string): boolean {
  const path = href.split("?")[0];
  const f = (FEATURES as readonly Feature[]).filter((x) => x.routes?.some((r) => path === r || path.startsWith(`${r}/`))).sort((a, b) => Math.max(...(b.routes ?? []).map((r) => r.length)) - Math.max(...(a.routes ?? []).map((r) => r.length)))[0];
  return !f || access.features[f.id as FeatureId].level !== NONE;
}

function HistoryButton({ userId }: { userId: string }) {
  const [rows, setRows] = useState<null | { id: number; created_at: string; action: string; actor_name: string; details: { reason?: string | null } | null }[]>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function load() {
    if (rows) { setRows(null); return; }
    setBusy(true); setErr(null);
    const r = await fetch(`/api/company/access?user=${userId}`).catch(() => null);
    const d = await r?.json().catch(() => null);
    setBusy(false);
    if (!r?.ok) { setErr(d?.error?.message ?? "Couldn't load the history."); return; }
    setRows(d.entries);
  }
  return (
    <>
      <Button type="button" variant="secondary" size="sm" onClick={load} aria-expanded={rows !== null} data-testid="access-history-toggle">{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <History className="h-4 w-4" aria-hidden />}Change history</Button>
      {err && <p role="alert" className="w-full text-sm text-danger">{err}</p>}
      {rows && (
        <div className="w-full rounded-lg border border-line bg-surface p-3" data-testid="access-history">
          {rows.length === 0 ? <p className="text-sm text-ink-soft">No access changes recorded yet.</p> : (
            <ul className="space-y-1 text-sm">{rows.map((h) => (
              <li key={h.id}><span className="text-ink-soft">{new Date(h.created_at).toLocaleString()}</span> · {h.actor_name} {h.action === "access.policy_updated" ? "changed company policy" : "changed access"}{h.details?.reason ? <>: <i>{h.details.reason}</i></> : null}</li>
            ))}</ul>
          )}
        </div>
      )}
    </>
  );
}

/**
 * Owner-only: company-wide restrictions and locks, by feature. Restricting a feature removes it from every
 * member (never from the primary account holder); locking means only the owner can change it for anyone.
 */
export function AccessPolicyCard({ policy }: { policy: AccessPolicy }) {
  const router = useRouter();
  const id = useId();
  const [denied, setDenied] = useState<Set<string>>(new Set(policy.denied));
  const [lockedSet, setLocked] = useState<Set<string>>(new Set(policy.locked));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [open, setOpen] = useState(false);
  const permsOf = (f: Feature) => f.options.flatMap((o) => o.perms) as string[];
  const toggle = (set: Set<string>, f: Feature, on: boolean) => { const n = new Set(set); for (const p of permsOf(f)) { if (on) n.add(p); else n.delete(p); } return n; };
  const has = (set: Set<string>, f: Feature) => permsOf(f).every((p) => set.has(p));
  async function save() {
    setBusy(true); setMsg(null);
    const r = await fetch("/api/company/access", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "policy", denied: [...denied], locked: [...lockedSet] }) }).catch(() => null);
    const d = await r?.json().catch(() => null);
    setBusy(false);
    if (!r?.ok) { setMsg({ ok: false, text: d?.error?.message ?? "Couldn't save the policy." }); return; }
    setMsg({ ok: true, text: "Company access policy saved." }); router.refresh();
  }
  const list = (FEATURES as readonly Feature[]).filter((f) => !f.appGated && f.section !== "admin");
  return (
    <div className="rounded-lg border border-line bg-surface p-4" data-testid="access-policy">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls={`${id}-body`} className="flex w-full items-center gap-2 text-left">
        <ShieldAlert className="h-5 w-5 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1"><span className="block font-display text-lg font-bold">Company access policy</span>
          <span className="block text-sm text-ink-soft">Only you (the primary account holder) can set these. {denied.size || lockedSet.size ? `${list.filter((f) => has(denied, f)).length} restricted, ${list.filter((f) => has(lockedSet, f)).length} locked.` : "Nothing restricted or locked."}</span></span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? "" : "-rotate-90"}`} aria-hidden />
      </button>
      {open && (
        <div id={`${id}-body`} className="mt-3">
          <p className="text-sm text-ink-soft"><b>Restrict</b> removes a feature from everyone in the company except you; a personal grant can&apos;t override it. <b>Lock</b> keeps each person&apos;s current setting but only you can change it (company administrators you delegate to can&apos;t).</p>
          <ul className="mt-2 divide-y divide-line">{list.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span className="min-w-0"><span className="font-semibold">{f.label}</span> <span className="text-xs text-ink-soft">· {WORKSPACE_INFO[f.section].label}</span></span>
              <span className="flex gap-4">
                <label className="flex min-h-9 items-center gap-2"><input type="checkbox" className="h-4 w-4" checked={has(denied, f)} onChange={(e) => setDenied(toggle(denied, f, e.target.checked))} data-testid={`policy-deny-${f.id}`} />Restrict</label>
                <label className="flex min-h-9 items-center gap-2"><input type="checkbox" className="h-4 w-4" checked={has(lockedSet, f)} onChange={(e) => setLocked(toggle(lockedSet, f, e.target.checked))} data-testid={`policy-lock-${f.id}`} />Lock</label>
              </span>
            </li>
          ))}</ul>
          <Button type="button" className="mt-3" onClick={save} disabled={busy} data-testid="policy-save">{busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}Save policy</Button>
          {msg && <p role={msg.ok ? "status" : "alert"} className={`mt-2 text-sm ${msg.ok ? "text-ok" : "text-danger"}`}>{msg.text}</p>}
        </div>
      )}
    </div>
  );
}

