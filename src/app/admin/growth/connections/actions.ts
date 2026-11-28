"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit, requireAdmin } from "@/lib/admin/server";
import { growthFunctionsBase, growthRpc } from "@/lib/growth-os/connections";
import { connectorByProvider, privilegedScopes } from "../../../../../growth-os/connectors/registry";

/**
 * Growth OS Connections Center admin actions. Owner-only (requireAdmin, incl. the authenticator step), audited in
 * the app (audit_logs) and again in Growth OS (growth.audit, on_behalf = this admin). Nothing here handles a
 * password, recovery code, MFA code or token: OAuth happens on the platform's own screen, and manual secrets are
 * pasted by the owner directly into the Growth OS project's Vault.
 */
const PAGE = "/admin/growth/connections";
const back = (q: string): never => redirect(`${PAGE}?${q}`);
const Provider = z.string().refine((p) => connectorByProvider.has(p), "Unknown connector");
const Account = z.string().trim().regex(/^[A-Za-z0-9_.:@-]{1,120}$/, "Account: letters, numbers and . _ : @ - only");
const get = (f: FormData, k: string) => { const v = f.get(k); return typeof v === "string" ? v : ""; };

async function run(form: FormData, action: string, fn: (p: { provider: string; account: string; onBehalf: string }) => Promise<string | void>) {
  const { user, db } = await requireAdmin();
  const provider = Provider.safeParse(get(form, "provider"));
  const account = Account.safeParse(get(form, "account"));
  if (!provider.success || !account.success) back(`error=${encodeURIComponent((provider.error ?? account.error)?.issues[0]?.message ?? "Check the form")}`);
  const onBehalf = `admin:${user.id}`;
  await audit(db, user.id, `growth_connections.${action}`, "growth_connector", `${provider.data}/${account.data}`);
  let dest: string | void = undefined;
  try { dest = await fn({ provider: provider.data!, account: account.data!, onBehalf }); }
  catch (e) { back(`error=${encodeURIComponent((e as Error).message)}#${provider.data}`); }
  revalidatePath(PAGE);
  if (dest) redirect(dest);
  back(`ok=${encodeURIComponent(action)}#${provider.data}`);
}

export async function registerConnection(form: FormData) {
  await run(form, "register", async ({ provider, account, onBehalf }) => {
    await growthRpc("register_connection", { p_provider: provider, p_account_ref: account, p_account_label: get(form, "label").slice(0, 200) || null, p_simulated: false, p_on_behalf: onBehalf });
  });
}

/** Starts OAuth: mints a one-time link in Growth OS and sends the owner to the platform's own consent screen. */
export async function connectOAuth(form: FormData) {
  await run(form, "oauth_begin", async ({ provider, account, onBehalf }) => {
    const extra = form.getAll("privileged").map(String).filter((s) => privilegedScopes(connectorByProvider.get(provider)!).includes(s));
    const scopes = extra.length ? [...new Set([...(connectorByProvider.get(provider)!.operations.filter((o) => !o.privileged && o.phase <= 5 && o.baseline !== "unsupported").flatMap((o) => o.scopes)), ...extra])] : null;
    const r = await growthRpc<{ state: string }>("oauth_begin", { p_provider: provider, p_account_ref: account, p_scopes: scopes, p_on_behalf: onBehalf });
    return `${growthFunctionsBase()}/growth-oauth/start?s=${encodeURIComponent(r.state)}`;
  });
}

export async function approvePrivileged(form: FormData) {
  await run(form, "approve_privileged_scopes", async ({ provider, account, onBehalf }) => {
    if (get(form, "confirm") !== "yes") throw new Error("Tick the confirmation box to approve privileged permissions");
    const allowed = privilegedScopes(connectorByProvider.get(provider)!);
    const scopes = form.getAll("scope").map(String).filter((s) => allowed.includes(s));
    if (!scopes.length) throw new Error("Pick at least one privileged permission");
    await growthRpc("approve_privileged_scopes", { p_provider: provider, p_account_ref: account, p_scopes: scopes, p_on_behalf: onBehalf });
  });
}

export async function attachSecret(form: FormData) {
  await run(form, "attach_manual_secret", async ({ provider, account, onBehalf }) => {
    const name = get(form, "secret_name");
    if (!(connectorByProvider.get(provider)!.manualSecrets ?? []).some((m) => m.name === name)) throw new Error("Pick one of the listed secret names");
    await growthRpc("attach_manual_secret", { p_provider: provider, p_account_ref: account, p_secret_name: name, p_on_behalf: onBehalf });
    await growthRpc("request_health_check", { p_provider: provider, p_on_behalf: onBehalf });
  });
}

export async function checkNow(form: FormData) {
  await run(form, "request_health_check", async ({ provider, onBehalf }) => {
    await growthRpc("request_health_check", { p_provider: provider, p_on_behalf: onBehalf });
  });
}

export async function revokeConnection(form: FormData) {
  await run(form, "revoke", async ({ provider, account, onBehalf }) => {
    if (get(form, "confirm") !== "yes") throw new Error("Tick the confirmation box to revoke");
    await growthRpc("revoke_connection", { p_provider: provider, p_account_ref: account, p_reason: get(form, "reason").slice(0, 200) || null, p_on_behalf: onBehalf });
  });
}

export async function recordSubmission(form: FormData) {
  await run(form, "platform_submission", async ({ provider, onBehalf }) => {
    const status = z.enum(["drafted", "submitted", "approved", "rejected"]).parse(get(form, "status"));
    await growthRpc("record_platform_submission", { p_provider: provider, p_status: status, p_note: get(form, "note").slice(0, 500) || null, p_on_behalf: onBehalf });
  });
}
