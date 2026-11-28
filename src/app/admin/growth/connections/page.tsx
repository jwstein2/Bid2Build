import { Chip, PageHead, Panel, ago, day } from "@/components/admin/cc";
import { requireAdmin } from "@/lib/admin/server";
import { growthConfigured, loadOverview } from "@/lib/growth-os/connections";
import { STATUS_LABEL, STATUS_TONE, buildView, type CardView } from "@/lib/growth-os/connections-view";
import { STATUSES, connectorByProvider, privilegedScopes } from "../../../../../growth-os/connectors/registry";
import { approvePrivileged, attachSecret, checkNow, connectOAuth, recordSubmission, registerConnection, resumeConnector, revokeConnection } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Growth OS Connections" };

const str = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const btn = "cc-mono rounded-md border border-[var(--cc-line)] px-2.5 py-1 text-[11px] uppercase tracking-wider text-[var(--cc-blue)] hover:border-[var(--cc-blue)] hover:text-white";
const input = "rounded-md border border-[var(--cc-line)] bg-transparent px-2 py-1 text-xs text-white placeholder:text-muted";

function StatusChip({ status }: { status: CardView["status"] }) {
  return <Chip tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Chip>;
}

function Card({ c, live, now }: { c: CardView; live: boolean; now: number }) {
  const reg = connectorByProvider.get(c.provider);
  const priv = reg ? privilegedScopes(reg) : [];
  const oauth = c.authKinds.includes("oauth2");
  const manual = c.authKinds.includes("manual_secret");
  const acct = c.accountRef ?? "";
  return (
    <Panel id={c.provider} kicker={c.group} title={c.name} action={<div className="flex flex-wrap items-center gap-1.5">{c.simulated && <Chip tone="red">SIMULATED · not a real account</Chip>}{c.paused && <Chip tone="amber">Paused</Chip>}<StatusChip status={c.status} /></div>}>
      <p className="text-sm text-ink-soft">{c.lastError ?? c.reason}</p>
      <dl className="mt-3 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
        <div><dt className="inline text-muted">Account: </dt><dd className="inline text-white">{c.accountLabel ? `${c.accountLabel} (${acct})` : acct || "none registered"}</dd></div>
        <div><dt className="inline text-muted">Last good check: </dt><dd className="inline text-white">{c.lastVerifiedAt ? ago(c.lastVerifiedAt, now) : "never"}</dd></div>
        {c.expiresAt && <div><dt className="inline text-muted">Token expires: </dt><dd className="inline text-white">{day(c.expiresAt)}</dd></div>}
        {c.refreshFails > 0 && <div><dt className="inline text-muted">Refresh failures: </dt><dd className="inline text-[var(--cc-amber)]">{c.refreshFails}</dd></div>}
        {c.submission && <div><dt className="inline text-muted">Platform application: </dt><dd className="inline text-white">{c.submission.status} · {day(c.submission.at)}</dd></div>}
      </dl>

      <table className="mt-4 w-full text-left text-xs">
        <thead className="text-muted"><tr><th className="py-1 font-normal">Operation</th><th className="py-1 font-normal">Permissions</th><th className="py-1 font-normal">Status</th></tr></thead>
        <tbody>
          {c.operations.map((o) => (
            <tr key={o.key} className="border-t border-[var(--cc-line)] align-top">
              <td className="py-1.5 pr-2 text-white">{o.label}{o.privileged && <span className="ml-1 text-[var(--cc-violet)]">· privileged</span>}<span className="ml-1 text-muted">· phase {o.phase > 10 ? "n/a" : o.phase}</span>{o.note && <div className="text-muted">{o.note}</div>}</td>
              <td className="cc-mono py-1.5 pr-2 text-[11px] text-ink-soft">{o.scopes.length ? o.scopes.map((s) => <div key={s} className={o.missing.includes(s) && live && c.accountRef ? "text-[var(--cc-amber)]" : ""}>{s.replace("https://www.googleapis.com/auth/", "")}</div>) : "–"}</td>
              <td className="py-1.5"><StatusChip status={o.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>

      <details className="mt-4 text-xs">
        <summary className="cursor-pointer text-[var(--cc-blue)]">What it needs, limits and cost</summary>
        <div className="mt-2 space-y-1.5 text-ink-soft">
          <p><span className="text-muted">Already there: </span>{c.existing}</p>
          <p><span className="text-muted">Review / verification: </span>{c.review}</p>
          <p><span className="text-muted">Rate limits: </span>{c.limits}</p>
          <p><span className="text-muted">Cost: </span>{c.cost}</p>
          {c.docs.length > 0 && <p><span className="text-muted">Docs: </span>{c.docs.map((d) => <a key={d} href={d} target="_blank" rel="noreferrer" className="mr-2 text-[var(--cc-blue)] underline">{new URL(d).hostname}</a>)}</p>}
        </div>
      </details>
      <details className="mt-2 text-xs" open={c.status === "awaiting_authorization" || c.status === "awaiting_platform_approval"}>
        <summary className="cursor-pointer text-[var(--cc-blue)]">How to authorize (manual steps)</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-ink-soft">{c.manualSteps.map((s) => <li key={s}>{s}</li>)}</ol>
        <p className="mt-2 text-muted">Never type a password, recovery code or sign-in code anywhere except the platform&apos;s own site.</p>
      </details>

      {live && c.status !== "unsupported" && (
        <div className="mt-4 space-y-3 border-t border-[var(--cc-line)] pt-3">
          {!c.accountRef && (
            <form action={registerConnection} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="provider" value={c.provider} />
              <input name="account" required placeholder="Account id (Page id, property id…)" className={input} />
              <input name="label" placeholder="Label (optional)" className={input} />
              <button className={btn}>Register account</button>
            </form>
          )}
          {c.accountRef && !c.simulated && (
            <div className="flex flex-wrap items-start gap-2">
              {oauth && (
                <form action={connectOAuth}>
                  <input type="hidden" name="provider" value={c.provider} /><input type="hidden" name="account" value={acct} />
                  {c.approvedPrivileged.map((s) => <input key={s} type="hidden" name="privileged" value={s} />)}
                  <button className={btn}>{c.grantedScopes.length ? "Reconnect" : "Connect"} on the platform&apos;s screen</button>
                </form>
              )}
              {manual && (c.manualSecrets.length > 0) && (
                <form action={attachSecret} className="flex items-center gap-2">
                  <input type="hidden" name="provider" value={c.provider} /><input type="hidden" name="account" value={acct} />
                  <select name="secret_name" className={input}>{c.manualSecrets.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}</select>
                  <button className={btn}>Attach secret from Vault</button>
                </form>
              )}
              <form action={checkNow}><input type="hidden" name="provider" value={c.provider} /><input type="hidden" name="account" value={acct} /><button className={btn}>Check now</button></form>
              {c.paused && <form action={resumeConnector}><input type="hidden" name="provider" value={c.provider} /><input type="hidden" name="account" value={acct} /><button className={btn}>Resume connector</button></form>}
            </div>
          )}
          {c.accountRef && priv.length > 0 && (
            <details>
              <summary className="cursor-pointer text-xs text-[var(--cc-violet)]">Approve privileged permissions (owner only, recorded)</summary>
              <form action={approvePrivileged} className="mt-2 space-y-1 text-xs text-ink-soft">
                <input type="hidden" name="provider" value={c.provider} /><input type="hidden" name="account" value={acct} />
                {priv.map((s) => <label key={s} className="block"><input type="checkbox" name="scope" value={s} defaultChecked={c.approvedPrivileged.includes(s)} /> <span className="cc-mono">{s}</span></label>)}
                <label className="block"><input type="checkbox" name="confirm" value="yes" /> I approve these permissions for this account. Using them still needs each phase&apos;s go-ahead.</label>
                <button className={btn}>Approve</button>
              </form>
            </details>
          )}
          {c.accountRef && (
            <details>
              <summary className="cursor-pointer text-xs text-[var(--cc-red)]">Revoke</summary>
              <form action={revokeConnection} className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
                <input type="hidden" name="provider" value={c.provider} /><input type="hidden" name="account" value={acct} />
                <input name="reason" placeholder="Reason" className={input} />
                <label><input type="checkbox" name="confirm" value="yes" /> Delete the stored token</label>
                <button className={btn}>Revoke</button>
              </form>
              <p className="mt-1 text-muted">Also remove the app in the platform&apos;s own settings to cut access there.</p>
            </details>
          )}
          {c.status === "awaiting_platform_approval" && (
            <form action={recordSubmission} className="flex flex-wrap items-center gap-2 text-xs">
              <input type="hidden" name="provider" value={c.provider} /><input type="hidden" name="account" value="registry" />
              <select name="status" className={input}><option value="drafted">drafted</option><option value="submitted">submitted</option><option value="approved">approved</option><option value="rejected">rejected</option></select>
              <input name="note" placeholder="Note" className={input} />
              <button className={btn}>Record application status</button>
            </form>
          )}
          {c.checks.length > 0 && (
            <details>
              <summary className="cursor-pointer text-xs text-[var(--cc-blue)]">Last {c.checks.length} checks</summary>
              <ul className="cc-mono mt-2 space-y-1 text-[11px] text-ink-soft">
                {c.checks.map((x) => <li key={x.at + x.kind}>{ago(x.at, now)} · {x.kind} · {x.outcome}{x.httpStatus ? ` · HTTP ${x.httpStatus}` : ""}{x.missing.length ? ` · missing ${x.missing.join(", ")}` : ""}{x.message ? ` · ${x.message}` : ""}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}
    </Panel>
  );
}

export default async function GrowthConnections({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  const sp = await searchParams;
  const { overview, error, fetchedAt: now } = await loadOverview();
  const v = buildView(overview);
  const live = v.source === "live";
  const groups = [...new Set(v.cards.map((c) => c.group))];
  const flash = str(sp.error) || (str(sp.result) === "error" ? `The platform did not complete the connection (${str(sp.code) || "unknown"}).` : "");
  const ok = str(sp.ok) || (str(sp.result) === "connected" ? `${str(sp.provider)} authorized. The health check result is below.` : "");

  return (
    <div className="space-y-6">
      <PageHead kicker="Growth OS · Phase 5" title="Connections" intro="Every marketing and data integration Growth OS may use, with its real status. Only a successful API check in the last 26 hours shows as verified." />
      {!live && (
        <div role="status" className="rounded-lg border border-[var(--cc-amber)]/50 px-4 py-3 text-sm text-[var(--cc-amber)]">
          {growthConfigured() ? `Growth OS database unreachable: ${error}. ` : "This environment is not connected to the Growth OS database (GROWTH_SUPABASE_URL is not set). "}
          Showing registry baselines only. Nothing below is live.
        </div>
      )}
      {live && v.env && <p className="cc-mono text-xs text-muted">Growth OS environment: {v.env} · read {v.generatedAt ? ago(v.generatedAt, now) : "now"}</p>}
      {flash && <p role="alert" className="rounded-lg border border-[var(--cc-red)]/50 px-4 py-2 text-sm text-[var(--cc-red)]">{flash}</p>}
      {ok && !flash && <p role="status" className="rounded-lg border border-[var(--cc-green)]/50 px-4 py-2 text-sm text-[var(--cc-green)]">Done: {ok.replace(/_/g, " ")}</p>}
      {v.alerts.slice(0, 3).map((a) => <p key={a.at} role="alert" className="rounded-lg border border-[var(--cc-red)]/50 px-4 py-2 text-sm text-[var(--cc-red)]">{a.provider}: {a.message} ({ago(a.at, now)})</p>)}

      <div className="flex flex-wrap gap-2" aria-label="Status summary">
        {STATUSES.map((s) => <Chip key={s} tone={STATUS_TONE[s]}>{STATUS_LABEL[s]}: {v.counts[s]}</Chip>)}
      </div>

      {groups.map((g) => (
        <section key={g} className="space-y-4">
          <h2 className="cc-kicker">{g}</h2>
          <div className="grid gap-4 xl:grid-cols-2">{v.cards.filter((c) => c.group === g).map((c) => <Card key={c.provider} c={c} live={live} now={now} />)}</div>
        </section>
      ))}

      {live && v.audit.length > 0 && (
        <Panel title="Audit trail" kicker="Last 50 connection events">
          <ul className="cc-mono space-y-1 text-[11px] text-ink-soft">
            {v.audit.map((a, i) => <li key={i}>{day(a.at)} · {a.actor} · {a.action} · {String(a.detail?.provider ?? "")}{a.detail?.on_behalf ? ` · for ${String(a.detail.on_behalf)}` : ""}</li>)}
          </ul>
        </Panel>
      )}
    </div>
  );
}
