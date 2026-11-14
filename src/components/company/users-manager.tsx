"use client";
import { Check, Copy, Loader2, Mail, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Button, ButtonLink } from "../ui/button";
import { Badge, Card, Notice } from "../ui/misc";
import { OWNER_ONLY_PERMISSIONS, PERMISSION_KEYS, PERMISSION_LABELS, ROLE_LABELS, ROLE_PERMISSIONS, effectivePermissions, type CompanyRole, type Permission } from "@/lib/enterprise/permissions";

export type Member = { user_id: string; display_name: string | null; email: string | null; role: CompanyRole; status: "active" | "deactivated"; team_ids: string[]; managed_team_ids: string[]; joined_at: string; last_active_at: string | null; permissions_granted?: string[]; permissions_revoked?: string[] };
export type Team = { id: string; name: string; trade: string | null; member_count: number; manager_count: number };
export type Invite = { id: string; email: string; role: CompanyRole; team_id: string | null; expires_at: string; created_at: string };

type Props = {
  me: string; myPermissions: Permission[]; isOwner: boolean;
  seats: { used: number; limit: number; active: boolean }; canBuySeats: boolean;
  members: Member[]; teams: Team[]; invites: Invite[];
};

async function post(url: string, body: unknown, method = "POST") {
  const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const d = await r?.json().catch(() => null);
  return r?.ok ? { ok: true as const, data: d } : { ok: false as const, message: (d?.error?.message as string) ?? "Something went wrong. Please try again." };
}

const ROLES: Exclude<CompanyRole, "owner">[] = ["manager", "estimator", "viewer"];
const name = (m: Member) => m.display_name || m.email || "Team member";

export function UsersManager(p: Props) {
  const manageUsers = p.myPermissions.includes("manage_users");
  const manageTeams = p.myPermissions.includes("manage_teams");
  const free = Math.max(0, p.seats.limit - p.seats.used);
  const active = p.members.filter((m) => m.status === "active");
  const inactive = p.members.filter((m) => m.status !== "active");
  return (
    <>
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4" data-testid="seat-summary">
        <p className="text-sm"><b>{p.seats.used}</b> of <b>{p.seats.limit}</b> licensed seats in use{p.invites.length > 0 && <> (including {p.invites.length} pending invitation{p.invites.length === 1 ? "" : "s"})</>}. <span className="text-ink-soft">{free} free.</span></p>
        {p.canBuySeats && <ButtonLink href="/company/billing" variant="secondary" size="sm">Add licenses</ButtonLink>}
      </Card>
      {!p.seats.active && <Notice tone="warn" title="Enterprise isn't active">You can review your team, but invitations and reactivations are paused until the subscription is active.</Notice>}
      {manageUsers && <InviteForm teams={p.teams} free={free} canBuySeats={p.canBuySeats} disabled={!p.seats.active} />}
      {manageUsers && p.invites.length > 0 && <PendingInvites invites={p.invites} teams={p.teams} />}
      <Card className="p-0">
        <h2 className="border-b border-line px-4 py-3 font-display text-lg font-bold">Team members ({active.length})</h2>
        <ul className="divide-y divide-line">{active.map((m) => <MemberRow key={m.user_id} m={m} {...p} manageUsers={manageUsers} manageTeams={manageTeams} />)}</ul>
      </Card>
      {inactive.length > 0 && (
        <Card className="p-0">
          <h2 className="border-b border-line px-4 py-3 font-display text-lg font-bold">Deactivated ({inactive.length})</h2>
          <p className="px-4 pt-2 text-sm text-ink-soft">Deactivated people can&apos;t sign in to the company and don&apos;t use a seat. Everything they created stays with the company.</p>
          <ul className="divide-y divide-line">{inactive.map((m) => <MemberRow key={m.user_id} m={m} {...p} manageUsers={manageUsers} manageTeams={manageTeams} />)}</ul>
        </Card>
      )}
      {manageTeams && <TeamsCard teams={p.teams} />}
    </>
  );
}

function InviteForm({ teams, free, canBuySeats, disabled }: { teams: Team[]; free: number; canBuySeats: boolean; disabled: boolean }) {
  const router = useRouter();
  const id = useId();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Exclude<CompanyRole, "owner">>("estimator");
  const [team, setTeam] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [link, setLink] = useState<{ url: string; email: string } | null>(null);
  const [copied, setCopied] = useState(false);
  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null); setLink(null); setCopied(false);
    const r = await post("/api/company/invitations", { email, role, teamId: team || null });
    setBusy(false);
    if (!r.ok) { setErr(r.message); return; }
    setLink({ url: r.data.inviteUrl, email }); setEmail(""); router.refresh();
  }
  const mailto = link ? `mailto:${link.email}?subject=${encodeURIComponent("You're invited to join our team on Built2Bid")}&body=${encodeURIComponent(`Join our company account on Built2Bid using this link (valid for 7 days):\n\n${link.url}\n\nSign in with this email address to accept.`)}` : "";
  return (
    <Card className="p-4" data-testid="invite-form">
      <h2 className="flex items-center gap-2 font-display text-lg font-bold"><UserPlus className="h-5 w-5" aria-hidden /> Invite a team member</h2>
      <p className="mt-1 text-sm text-ink-soft">Each invitation uses one of your free licensed seats and never adds a charge. {free === 0 && (canBuySeats ? "All seats are in use: add licenses first." : "All seats are in use.")}</p>
      <form onSubmit={send} className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
        <div><label htmlFor={`${id}-e`} className="text-sm font-semibold">Email</label>
          <input id={`${id}-e`} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" className="mt-1 h-11 w-full rounded-lg border border-line bg-surface px-3 text-base" /></div>
        <div><label htmlFor={`${id}-r`} className="text-sm font-semibold">Role</label>
          <select id={`${id}-r`} value={role} onChange={(e) => setRole(e.target.value as typeof role)} className="mt-1 h-11 w-full rounded-lg border border-line bg-surface px-2 text-base">{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select></div>
        <div><label htmlFor={`${id}-t`} className="text-sm font-semibold">Team</label>
          <select id={`${id}-t`} value={team} onChange={(e) => setTeam(e.target.value)} className="mt-1 h-11 w-full rounded-lg border border-line bg-surface px-2 text-base"><option value="">No team</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
        <Button type="submit" disabled={busy || disabled || free === 0}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Create invitation</Button>
      </form>
      {err && <p role="alert" className="mt-2 text-sm text-danger">{err}</p>}
      {link && (
        <div className="mt-3 rounded-lg border border-ok/40 bg-ok-tint p-3" data-testid="invite-link">
          <p className="text-sm font-semibold">Invitation ready for {link.email}. Send them this link (shown only once):</p>
          <p className="mt-1 break-all font-mono text-xs">{link.url}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={() => navigator.clipboard.writeText(link.url).then(() => setCopied(true))}>{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied ? "Copied" : "Copy link"}</Button>
            <a href={mailto} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 text-sm font-semibold"><Mail className="h-4 w-4" aria-hidden />Email it</a>
          </div>
        </div>
      )}
    </Card>
  );
}

function PendingInvites({ invites, teams }: { invites: Invite[]; teams: Team[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function revoke(id: string) {
    setBusy(id); setErr(null);
    const r = await post("/api/company/invitations", { id }, "DELETE");
    setBusy(null);
    if (!r.ok) setErr(r.message); else router.refresh();
  }
  return (
    <Card className="p-0">
      <h2 className="border-b border-line px-4 py-3 font-display text-lg font-bold">Pending invitations ({invites.length})</h2>
      <ul className="divide-y divide-line">{invites.map((i) => (
        <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
          <div className="min-w-0"><p className="truncate font-semibold">{i.email}</p><p className="text-xs text-ink-soft">{ROLE_LABELS[i.role]}{i.team_id && ` · ${teams.find((t) => t.id === i.team_id)?.name ?? "Team"}`} · expires {new Date(i.expires_at).toLocaleDateString()}</p></div>
          <Button size="sm" variant="secondary" onClick={() => revoke(i.id)} disabled={busy === i.id}>Revoke (frees the seat)</Button>
        </li>
      ))}</ul>
      <p className="px-4 pb-3 text-xs text-ink-soft">To resend, create the invitation again: the old link stops working.</p>
      {err && <p role="alert" className="px-4 pb-3 text-sm text-danger">{err}</p>}
    </Card>
  );
}

function MemberRow({ m, me, myPermissions, isOwner, teams, manageUsers, manageTeams, seats }: Props & { m: Member; manageUsers: boolean; manageTeams: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const editable = manageUsers && m.role !== "owner" && m.user_id !== me;
  const teamNames = m.team_ids.map((t) => teams.find((x) => x.id === t)?.name).filter(Boolean);

  async function act(body: Record<string, unknown>, okText: string) {
    setBusy(true); setMsg(null);
    const r = await post("/api/company/members", body);
    setBusy(false);
    if (!r.ok) { setMsg({ ok: false, text: r.message }); return false; }
    setMsg({ ok: true, text: r.data?.sentTo ? `${okText} ${r.data.sentTo}.` : okText }); router.refresh(); return true;
  }

  return (
    <li className="px-4 py-3" data-testid="member-row">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold">{name(m)}{m.user_id === me && <span className="font-normal text-ink-soft"> (you)</span>}</p>
          <p className="truncate text-xs text-ink-soft">{m.email && m.display_name ? `${m.email} · ` : ""}{teamNames.length ? teamNames.join(", ") : "No team"}{m.managed_team_ids.length > 0 && " · Team manager"}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={m.role === "owner" ? "brand" : m.role === "manager" ? "accent" : "neutral"}>{ROLE_LABELS[m.role]}</Badge>
          {(editable || (manageTeams && m.status === "active")) && <Button size="sm" variant="secondary" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "Close" : "Manage"}</Button>}
        </div>
      </div>
      {open && (
        <div className="mt-3 space-y-4 rounded-lg bg-paper p-3">
          {editable && m.status === "active" && <AccessEditor m={m} myPermissions={myPermissions} isOwner={isOwner} busy={busy} onSave={(b) => act({ action: "update", userId: m.user_id, ...b }, "Access updated.")} />}
          {manageTeams && m.status === "active" && teams.length > 0 && <TeamEditor m={m} teams={teams} busy={busy} onChange={(teamId, isManager, remove) => act({ action: "team_member", teamId, userId: m.user_id, isManager, remove }, "Teams updated.")} />}
          {editable && (
            <div className="flex flex-wrap gap-2 border-t border-line pt-3">
              {m.status === "active" ? (
                !confirm ? <Button size="sm" variant="secondary" onClick={() => setConfirm(true)}>Deactivate…</Button> : (
                  <div role="alertdialog" aria-label={`Deactivate ${name(m)}?`} className="w-full rounded-lg border border-warn/50 bg-warn-tint p-3 text-sm">
                    <p className="font-bold">Deactivate {name(m)}?</p>
                    <ul className="mt-1 list-disc pl-5 text-ink-soft">
                      <li>Their access to the company ends immediately.</li>
                      <li>Their seat becomes free for someone else. Your bill doesn&apos;t change until you remove licenses on Billing & Licenses.</li>
                      <li>All bids, customers and history they created stay with the company.</li>
                      <li>You can reactivate them later if a seat is free.</li>
                    </ul>
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" onClick={async () => { if (await act({ action: "status", userId: m.user_id, status: "deactivated" }, "Deactivated.")) setConfirm(false); }} disabled={busy}>Yes, deactivate</Button>
                      <Button size="sm" variant="secondary" onClick={() => setConfirm(false)}>Cancel</Button>
                    </div>
                  </div>
                )
              ) : <Button size="sm" onClick={() => act({ action: "status", userId: m.user_id, status: "active" }, "Reactivated.")} disabled={busy || !seats.active}>Reactivate (uses a seat)</Button>}
              {m.status === "active" && !confirm && <Button size="sm" variant="secondary" onClick={() => act({ action: "recovery", userId: m.user_id }, "Sign-in link sent to")} disabled={busy}>Send secure sign-in link</Button>}
            </div>
          )}
          {msg && <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-ok" : "text-danger"}`}>{msg.text}</p>}
        </div>
      )}
    </li>
  );
}

function AccessEditor({ m, myPermissions, isOwner, busy, onSave }: { m: Member; myPermissions: Permission[]; isOwner: boolean; busy: boolean; onSave: (b: { role: string; granted: string[]; revoked: string[] }) => void }) {
  const id = useId();
  const [role, setRole] = useState<Exclude<CompanyRole, "owner">>(m.role === "owner" ? "manager" : m.role);
  const [perms, setPerms] = useState<Set<Permission>>(new Set(effectivePermissions(m.role, m.permissions_granted ?? [], m.permissions_revoked ?? [])));
  const changeRole = (r: typeof role) => { setRole(r); setPerms(new Set(ROLE_PERMISSIONS[r])); };
  const canGrant = (k: Permission) => isOwner || (myPermissions.includes(k) && !OWNER_ONLY_PERMISSIONS.includes(k));
  const save = () => {
    const defaults = new Set<string>(ROLE_PERMISSIONS[role]);
    onSave({ role, granted: PERMISSION_KEYS.filter((k) => perms.has(k) && !defaults.has(k)), revoked: PERMISSION_KEYS.filter((k) => !perms.has(k) && defaults.has(k)) });
  };
  return (
    <div>
      <label htmlFor={`${id}-role`} className="text-sm font-semibold">Role</label>
      <select id={`${id}-role`} value={role} onChange={(e) => changeRole(e.target.value as typeof role)} className="mt-1 block h-11 w-full max-w-xs rounded-lg border border-line bg-surface px-2 text-base">{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select>
      <fieldset className="mt-3">
        <legend className="text-sm font-semibold">Permissions</legend>
        <div className="mt-1 grid gap-1 sm:grid-cols-2">{PERMISSION_KEYS.map((k) => (
          <label key={k} className={`flex min-h-9 items-center gap-2 text-sm ${canGrant(k) ? "" : "opacity-60"}`}>
            <input type="checkbox" className="h-4 w-4" checked={perms.has(k)} disabled={!canGrant(k) && !perms.has(k)}
              onChange={(e) => { const n = new Set(perms); if (e.target.checked) n.add(k); else n.delete(k); setPerms(n); }} />
            {PERMISSION_LABELS[k]}{OWNER_ONLY_PERMISSIONS.includes(k) && <span className="text-xs text-ink-soft">(owner grants only)</span>}
          </label>
        ))}</div>
      </fieldset>
      <Button size="sm" className="mt-3" onClick={save} disabled={busy}>Save access</Button>
    </div>
  );
}

function TeamEditor({ m, teams, busy, onChange }: { m: Member; teams: Team[]; busy: boolean; onChange: (teamId: string, isManager: boolean, remove: boolean) => void }) {
  return (
    <fieldset>
      <legend className="text-sm font-semibold">Teams</legend>
      <ul className="mt-1 space-y-1">{teams.map((t) => {
        const on = m.team_ids.includes(t.id);
        const mgr = m.managed_team_ids.includes(t.id);
        return (
          <li key={t.id} className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex min-h-9 items-center gap-2"><input type="checkbox" className="h-4 w-4" checked={on} disabled={busy} onChange={(e) => onChange(t.id, false, !e.target.checked)} />{t.name}</label>
            {on && <label className="flex min-h-9 items-center gap-2 text-ink-soft"><input type="checkbox" className="h-4 w-4" checked={mgr} disabled={busy} onChange={(e) => onChange(t.id, e.target.checked, false)} />Manages this team</label>}
          </li>
        );
      })}</ul>
    </fieldset>
  );
}

function TeamsCard({ teams }: { teams: Team[] }) {
  const router = useRouter();
  const id = useId();
  const [nameV, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function create(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    const r = await post("/api/company/members", { action: "team_create", name: nameV });
    setBusy(false);
    if (!r.ok) setErr(r.message); else { setName(""); router.refresh(); }
  }
  return (
    <Card className="p-4">
      <h2 className="font-display text-lg font-bold">Teams</h2>
      <p className="text-sm text-ink-soft">Managers and reviewers see bids from the teams they belong to. Example: a Roofing team with a Roofing manager and roofing estimators.</p>
      {teams.length > 0 && <ul className="mt-2 divide-y divide-line">{teams.map((t) => <li key={t.id} className="flex justify-between py-2 text-sm"><span className="font-semibold">{t.name}</span><span className="text-ink-soft">{t.member_count} member{t.member_count === 1 ? "" : "s"} · {t.manager_count} manager{t.manager_count === 1 ? "" : "s"}</span></li>)}</ul>}
      <form onSubmit={create} className="mt-3 flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1"><label htmlFor={`${id}-n`} className="text-sm font-semibold">New team</label>
          <input id={`${id}-n`} value={nameV} required maxLength={120} onChange={(e) => setName(e.target.value)} className="mt-1 h-11 w-full rounded-lg border border-line bg-surface px-3 text-base" /></div>
        <Button type="submit" disabled={busy}>Create team</Button>
      </form>
      {err && <p role="alert" className="mt-2 text-sm text-danger">{err}</p>}
    </Card>
  );
}
