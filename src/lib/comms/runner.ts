import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logError } from "@/lib/http/api";
import { site } from "@/lib/site";
import { rowToBusiness } from "@/lib/data/mappers";
import { hashSigningToken, newSigningToken } from "@/lib/esign/token";
import { tradeName } from "@/lib/trades/catalog";
import { todayIn } from "@/lib/schedule/calendar";
import { buildCustomerReport, DEFAULT_REPORT_OPTIONS, reportOptionsSchema, type CustomerReport, type ReportOptions } from "@/lib/schedule/report";
import { commConfig, replyMonitoring, type CommConfig } from "./config";
import { buildAudience, isSuppressed } from "./eligibility";
import { renderNurture } from "./nurture";
import { buildProjectUpdateEmail, milestoneCandidates, staleReason, upcomingWeekly, wantsMilestone, wantsWeekly } from "./project-updates";
import { fromHeader, newRfcMessageId, sendCommEmail } from "./send";
import {
  accountBranding, accountOwner, loadContactFacts, loadEstimateFacts, loadOffers, loadScheduleAdmin, loadSettings, loadSuppressions, logEvent, notify, projectReviewer,
} from "./server";
import { TERMS_MESSAGE, termsCurrent } from "./rollout";
import { localDate, safeTz } from "./time";
import { newReplyToken, replyAddress, unsubUrls } from "./tokens";
import { mapSettings, type CommSettings, type UpdateFrequency } from "./types";
import { planFinancialReminders, prepareFinancialReminder } from "@/lib/financials/reminder-run";

type Row = Record<string, unknown>;
type Db = SupabaseClient;
const iso = (d: Date) => d.toISOString();

// ---------------------------------------------------------------------------------------------
// Project update content
// ---------------------------------------------------------------------------------------------
export interface RenderedUpdate { report: CustomerReport; options: ReportOptions; subject: string; body: string; logoPath: string | null; companyId: string | null; estimateId: string; revision: number; recipient: { email: string | null; name: string } }

export async function renderUpdate(admin: Db, scheduleId: string, o: { link?: string | null; milestoneTaskId?: string | null; unsubscribeUrl?: string | null; postalAddress?: string | null; now?: Date }): Promise<RenderedUpdate | null> {
  const data = await loadScheduleAdmin(admin, scheduleId);
  if (!data) return null;
  const ownerId = String(data.raw.user_id);
  const [{ data: bp }, { data: pubs }, { data: est }, { data: pcs }] = await Promise.all([
    admin.from("business_profiles").select("*").eq("user_id", ownerId).maybeSingle(),
    admin.from("schedule_publications").select("content, options").eq("schedule_id", scheduleId).order("version", { ascending: false }).limit(1),
    admin.from("estimates").select("customer_email, customer_name").eq("id", data.schedule.estimateId).maybeSingle(),
    admin.from("project_comm_settings").select("recipient_email, recipient_name").eq("schedule_id", scheduleId).maybeSingle(),
  ]);
  const b = rowToBusiness(bp as Row | null);
  const last = ((pubs ?? []) as Row[])[0];
  const parsed = reportOptionsSchema.safeParse(last?.options ?? {});
  const options = parsed.success ? parsed.data : DEFAULT_REPORT_OPTIONS;
  const today = todayIn(data.schedule.calendar.timezone, o.now);
  const report = buildCustomerReport(data, options, {
    company: { name: b.companyName, phone: b.phone ?? null, email: b.email ?? null, website: b.website ?? null, color: b.primaryColor ?? null, hasLogo: Boolean(b.logoPath) },
    today, tradeLabel: tradeName, previous: (last?.content as CustomerReport) ?? null,
  });
  const milestone = o.milestoneTaskId ? data.tasks.find((t) => t.id === o.milestoneTaskId && t.status === "complete") : null;
  const mail = buildProjectUpdateEmail(report, {
    link: o.link ?? null, contactName: b.contactName ?? null, milestone: milestone ? { sectionName: milestone.name } : null,
    unsubscribeUrl: o.unsubscribeUrl ?? null, postalAddress: o.postalAddress ?? b.address ?? null,
  });
  const pc = pcs as Row | null;
  const e = est as Row | null;
  return {
    report, options, subject: mail.subject, body: mail.body, logoPath: (b as { logoPath?: string | null }).logoPath ?? null, companyId: data.schedule.companyId,
    estimateId: data.schedule.estimateId, revision: data.schedule.revision,
    recipient: { email: String(pc?.recipient_email || e?.customer_email || "").trim().toLowerCase() || null, name: String(pc?.recipient_name || e?.customer_name || report.customerName || "") },
  };
}

// ---------------------------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------------------------
async function insertMessage(admin: Db, row: Row): Promise<boolean> {
  const { data, error } = await admin.from("comm_messages").upsert(row, { onConflict: "idempotency_key", ignoreDuplicates: true }).select("id");
  if (error) { logError("comms.insert", error); return false; }
  return Boolean(data?.length);
}

export async function planProjectUpdates(admin: Db, now: Date, out: Record<string, number>) {
  const { data: rows } = await admin.from("project_comm_settings").select("*").neq("frequency", "off").is("paused_at", null).limit(2000);
  const settingsCache = new Map<string, CommSettings>();
  for (const pc of (rows ?? []) as Row[]) {
    try {
      const accountId = String(pc.account_id);
      const settings = settingsCache.get(accountId) ?? (await loadSettings(admin, accountId));
      settingsCache.set(accountId, settings);
      if (settings.pausedAt || settings.disabledAt || !termsCurrent(settings)) continue;
      const sid = String(pc.schedule_id);
      const { data: s } = await admin.from("project_schedules").select("id, status, calendar").eq("id", sid).maybeSingle();
      if (!s || (s as Row).status !== "active") continue;
      const tz = safeTz(settings.timezone);
      const freq = pc.frequency as UpdateFrequency;
      const auto = pc.mode === "automatic";
      // Not reviewed in time: retire it so the next one replaces it (never sent late without review).
      await admin.from("comm_messages").update({ status: "skipped", status_reason: "Not reviewed before the next update" })
        .eq("schedule_id", sid).eq("kind", "project_update").eq("status", "awaiting_review").lt("scheduled_for", iso(new Date(now.getTime() - 5 * 86_400_000)));
      const make = async (key: string, trigger: "weekly" | "milestone", scheduledFor: Date, reminderAt: Date, taskId: string | null) => {
        const r = await renderUpdate(admin, sid, { milestoneTaskId: taskId, postalAddress: settings.postalAddress, now });
        if (!r?.recipient.email) { out.noRecipient = (out.noRecipient ?? 0) + 1; return; }
        const supp = await loadSuppressions(admin, accountId, [r.recipient.email]);
        if (isSuppressed(supp, accountId, r.recipient.email, "project_updates")) return;
        const created = await insertMessage(admin, {
          account_id: accountId, kind: "project_update", trigger, schedule_id: sid, estimate_id: r.estimateId, task_id: taskId,
          to_email: r.recipient.email, to_name: r.recipient.name.slice(0, 200), subject: r.subject, body_text: r.body, content: { report: r.report, options: r.options, revision: r.revision },
          status: auto ? "scheduled" : "awaiting_review", scheduled_for: iso(scheduledFor), reminder_at: iso(reminderAt), automation: true, idempotency_key: key,
        });
        if (created) out.planned = (out.planned ?? 0) + 1;
      };
      if (wantsWeekly(freq)) {
        const w = upcomingWeekly(now, tz, settings.updatesWeekday, settings.updatesHour);
        if (now >= w.createFrom) await make(`pu:${sid}:weekly:${localDate(w.slot, tz)}`, "weekly", w.slot, w.reminderAt, null);
      }
      if (wantsMilestone(freq) && pc.enabled_at) {
        const data = await loadScheduleAdmin(admin, sid);
        const enabledOn = localDate(new Date(String(pc.enabled_at)), tz);
        for (const t of milestoneCandidates(data?.tasks ?? [], enabledOn)) {
          // Review first: waits for approval. Automatic: a 2-hour window after the reminder.
          await make(`pu:${sid}:milestone:${t.id}`, "milestone", auto ? new Date(now.getTime() + 2 * 3_600_000) : now, now, t.id);
        }
      }
    } catch (e) { logError("comms.plan_update", e, { schedule: String(pc.schedule_id) }); }
  }
}

/** Day-before (or as-soon-as-ready) reminder to the responsible PM. One per message, ever. */
export async function sendReminders(admin: Db, now: Date, out: Record<string, number>) {
  const { data } = await admin.from("comm_messages").select("id, account_id, schedule_id, to_name, scheduled_for, status, trigger, content, task_id")
    .eq("kind", "project_update").in("status", ["awaiting_review", "scheduled"]).lte("reminder_at", iso(now)).is("reminder_notified_at", null).limit(500);
  for (const m of (data ?? []) as Row[]) {
    const { data: s } = await admin.from("project_schedules").select("id, name, project_manager_id, created_by, user_id, company_id").eq("id", String(m.schedule_id)).maybeSingle();
    if (!s) continue;
    const settings = await loadSettings(admin, String(m.account_id));
    const report = ((m.content as Row)?.report ?? null) as CustomerReport | null;
    const current = (report?.sections ?? []).filter((x) => x.state === "current").slice(0, 3).map((x) => ({ name: x.name, status: x.statusLabel, progress: x.progress, plannedEnd: x.plannedEnd }));
    const review = m.status === "awaiting_review";
    const hours = (Date.parse(String(m.scheduled_for)) - now.getTime()) / 3_600_000;
    await notify(admin, {
      userId: projectReviewer(s as Row), companyId: ((s as Row).company_id as string) ?? null, kind: "customer_update", dedupeKey: `customer_update:${m.id}`, scheduleId: String(m.schedule_id),
      title: hours > 12 ? "Customer update scheduled for tomorrow" : review ? "Customer update ready for your review" : "Customer update sending soon",
      data: { messageId: m.id, projectName: (s as Row).name, customerName: m.to_name, scheduledFor: m.scheduled_for, timezone: settings.timezone, mode: review ? "review" : "automatic", trigger: m.trigger, sections: current },
    });
    await admin.from("comm_messages").update({ reminder_notified_at: iso(now) }).eq("id", String(m.id));
    out.reminders = (out.reminders ?? 0) + 1;
  }
}

export async function planNurture(admin: Db, now: Date, cfg: CommConfig, monitoringActive: boolean, out: Record<string, number>, onlyAccount?: string) {
  let q = admin.from("comm_settings").select("*").eq("nurture_enabled", true).not("nurture_activated_at", "is", null).is("paused_at", null).limit(2000);
  if (onlyAccount) q = q.eq("account_id", onlyAccount);
  const { data: rows } = await q;
  for (const r of (rows ?? []) as Row[]) {
    const accountId = String(r.account_id);
    try {
      const settings = mapSettings(r);
      if (settings.disabledAt || !termsCurrent(settings)) continue;
      if (!settings.postalAddress) { out.noPostal = (out.noPostal ?? 0) + 1; continue; }
      const kind = r.account_kind === "company" ? "company" : "user";
      const [estimates, contacts, suppressions, offers, brand] = await Promise.all([
        loadEstimateFacts(admin, accountId, kind), loadContactFacts(admin, accountId), loadSuppressions(admin, accountId), loadOffers(admin, accountId), accountBranding(admin, accountId),
      ]);
      const audience = buildAudience({ accountId, estimates, contacts, suppressions, now, months: settings.nurtureMonths });
      const auto = settings.nurtureMode === "automatic" && monitoringActive;
      for (const e of audience) {
        if (!e.contactId || e.excluded || !e.due) continue;
        const id = randomUUID();
        const urls = unsubUrls(site.url, id);
        const msg = renderNurture(e, {
          subject: settings.nurtureSubject, body: settings.nurtureBody, offers, includeOffers: settings.nurtureIncludeOffers,
          ctx: { companyName: brand.companyName, senderName: settings.senderName || brand.contactName || brand.companyName, postalAddress: settings.postalAddress, unsubscribeUrl: urls.page, today: localDate(now, settings.timezone) },
        });
        const created = await insertMessage(admin, {
          id, account_id: accountId, kind: "nurture", trigger: "six_month", contact_id: e.contactId, customer_id: e.customerId, estimate_id: e.estimate.id,
          to_email: e.email, to_name: e.name.slice(0, 200), subject: msg.subject, body_text: msg.body, content: msg.facts, template_version: settings.templateVersion, offer_id: msg.offerId,
          status: auto ? "scheduled" : "awaiting_review", status_reason: settings.nurtureMode === "automatic" && !monitoringActive ? "Reply monitoring isn't active, so each follow-up waits for approval." : null,
          scheduled_for: iso(now), automation: true, idempotency_key: `nu:${e.contactId}:${e.nextDueAt.slice(0, 10)}`,
        });
        if (created) out.nurturePlanned = (out.nurturePlanned ?? 0) + 1;
      }
    } catch (e) { logError("comms.plan_nurture", e, { account: accountId }); }
  }
}

// ---------------------------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------------------------
async function sentToday(admin: Db, now: Date, accountId?: string): Promise<number> {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  let q = admin.from("comm_messages").select("id", { count: "exact", head: true }).gte("sent_at", start);
  if (accountId) q = q.eq("account_id", accountId);
  const { count } = await q;
  return count ?? 0;
}

/** Freeze the customer report as a publication with a 60-day secure link (same as a manual publish). */
async function publishSnapshot(admin: Db, scheduleId: string, r: RenderedUpdate, approvedBy: string | null): Promise<{ id: string; link: string } | null> {
  const { data: last } = await admin.from("schedule_publications").select("version").eq("schedule_id", scheduleId).order("version", { ascending: false }).limit(1);
  const version = Number(((last ?? []) as Row[])[0]?.version ?? 0) + 1;
  const token = newSigningToken();
  const nowIso = new Date().toISOString();
  const { data, error } = await admin.from("schedule_publications").insert({
    schedule_id: scheduleId, estimate_id: r.estimateId, company_id: r.companyId, version, schedule_revision: r.revision, published_by: approvedBy,
    publisher_name: approvedBy ? null : "Automatic customer update", options: r.options, content: r.report,
    content_hash: createHash("sha256").update(JSON.stringify(r.report)).digest("hex"), logo_path: r.options.branding ? r.logoPath : null,
    token_hash: hashSigningToken(token), link_created_at: nowIso, link_expires_at: new Date(Date.now() + 60 * 86_400_000).toISOString(),
    delivery: [{ method: "link_created", at: nowIso, by: approvedBy }],
  }).select("id").single();
  if (error || !data) { logError("comms.publish", error); return null; }
  return { id: String((data as Row).id), link: `${site.url.replace(/\/+$/, "")}/updates/${token}` };
}

export async function deliverDue(admin: Db, now: Date, cfg: CommConfig, monitoringActive: boolean, out: Record<string, number>, ids?: string[]) {
  if (!cfg.enabled) return;
  let q = admin.from("comm_messages").select("*").in("status", ["approved", "scheduled", "failed"]).lte("scheduled_for", iso(now)).lt("attempts", 5)
    .order("scheduled_for", { ascending: true }).limit(ids?.length ? ids.length : 50);
  if (ids?.length) q = q.in("id", ids);
  const { data: rows } = await q;
  let total = await sentToday(admin, now);
  for (const m of (rows ?? []) as Row[]) {
    if (total >= cfg.dailyCap) { out.capped = (out.capped ?? 0) + 1; break; }
    const id = String(m.id);
    const prior = String(m.status);
    if (prior === "failed" && Date.parse(String(m.updated_at)) > now.getTime() - 15 * 60_000) continue;
    const { data: claimed } = await admin.from("comm_messages").update({ status: "sending", attempts: Number(m.attempts) + 1, locked_until: iso(new Date(now.getTime() + 120_000)) })
      .eq("id", id).eq("status", prior).eq("attempts", Number(m.attempts)).select("id");
    if (!claimed?.length) continue;
    const back = (status: string, reason: string, extra: Row = {}) => admin.from("comm_messages").update({ status, status_reason: reason.slice(0, 300), locked_until: null, attempts: Number(m.attempts), ...extra }).eq("id", id);
    try {
      const accountId = String(m.account_id);
      const settings = await loadSettings(admin, accountId);
      const to = String(m.to_email ?? "").toLowerCase();
      const g = await admin.from("comm_global").select("paused").eq("id", 1).maybeSingle();
      if ((g.data as Row | null)?.paused) { await back(prior, "Built2Bid paused all automated email"); break; }
      if (m.kind === "financial" && settings.disabledAt) { await back("canceled", "Customer emails were turned off by the account owner"); continue; }
      if (m.kind === "nurture" || m.kind === "project_update") {
        if (settings.disabledAt) { await back("canceled", "Customer emails were turned off by the account owner"); continue; }
        if (!termsCurrent(settings)) { await back("awaiting_review", TERMS_MESSAGE); continue; }
      }
      if (settings.pausedAt) { await back("paused", "Your team paused all customer emails"); continue; }
      if (!to) { await back("failed", "No customer email address", { attempts: 5 }); continue; }
      if (cfg.mode === "test" && !cfg.testRecipients.includes(to)) { await back("skipped", "Test mode: only test addresses receive email"); continue; }
      const supp = await loadSuppressions(admin, accountId, [to]);
      // Payment reminders are transactional: only an "all email" suppression (bounce, complaint) stops them.
      const suppressed = m.kind === "financial" ? supp.find((x) => x.email === to && (x.accountId === null || x.accountId === accountId) && x.scope === "all")
        : isSuppressed(supp, accountId, to, m.kind === "nurture" ? "marketing" : "project_updates");
      if (suppressed) { await back("canceled", "Address is suppressed"); continue; }
      if ((await sentToday(admin, now, accountId)) >= cfg.accountDailyCap) { await back(prior, "Daily sending limit reached; will continue tomorrow"); continue; }
      const brand = await accountBranding(admin, accountId);
      let subject = String(m.subject), body = String(m.body_text), content = m.content as Row, publicationId: string | null = null;
      const unsub = unsubUrls(site.url, id);

      if (m.kind === "nurture") {
        const { data: c } = m.contact_id ? await admin.from("comm_contacts").select("status").eq("id", String(m.contact_id)).maybeSingle() : { data: null };
        if (!settings.nurtureEnabled || !settings.nurtureActivatedAt) { await back("canceled", "Customer follow-ups were turned off"); continue; }
        if ((c as Row | null)?.status !== "eligible") { await back("canceled", `Contact is ${(c as Row | null)?.status ?? "no longer enrolled"}`); continue; }
        if (!settings.postalAddress) { await back(prior === "scheduled" ? "awaiting_review" : prior, "Add your business postal address before follow-ups can send"); continue; }
        if (prior === "scheduled" && !(settings.nurtureMode === "automatic" && monitoringActive)) { await back("awaiting_review", "Reply monitoring isn't active, so this follow-up waits for approval."); continue; }
      } else if (m.kind === "financial") {
        const r = await prepareFinancialReminder(admin, m, now);
        if (!r.ok) { await back("canceled", r.reason); continue; }
        if (r.mail.toEmail !== to) { await back(prior, "The customer's email address changed; sending to the new address next run", { to_email: r.mail.toEmail }); continue; }
        subject = r.mail.subject; body = r.mail.body;
        await admin.from("comm_messages").update({ fin_fields_hash: r.mail.fieldsHash }).eq("id", id);
      } else {
        const sid = String(m.schedule_id ?? "");
        const { data: pc } = await admin.from("project_comm_settings").select("*").eq("schedule_id", sid).maybeSingle();
        const p = pc as Row | null;
        const data = sid ? await loadScheduleAdmin(admin, sid) : null;
        const freq = (p?.frequency ?? "off") as UpdateFrequency;
        const triggerOk = m.trigger === "manual" || (m.trigger === "weekly" ? wantsWeekly(freq) : wantsMilestone(freq));
        if (!p || p.paused_at || !triggerOk || !data || data.schedule.status !== "active") { await back("canceled", "Project updates were turned off or the project isn't active"); continue; }
        const today = todayIn(data.schedule.calendar.timezone, now);
        if (prior === "scheduled") {
          if (p.mode !== "automatic") { await back("awaiting_review", "This project now needs review before sending"); continue; }
          const stale = staleReason(data, today, now);
          if (stale) { await back("awaiting_review", `Paused for review: ${stale}`); continue; }
        } else if (prior === "approved" && Number(m.approved_revision ?? -1) !== data.schedule.revision) {
          await back("awaiting_review", "The schedule changed after this update was approved. Please review it again."); continue;
        } else if (!m.approved_by && prior !== "scheduled" && p.mode !== "automatic") {
          await back("awaiting_review", "Needs approval before sending"); continue;
        }
        const r = await renderUpdate(admin, sid, { milestoneTaskId: (m.task_id as string) ?? null, postalAddress: settings.postalAddress, unsubscribeUrl: unsub.page, now });
        if (!r) { await back("failed", "Could not build the update"); continue; }
        const pub = await publishSnapshot(admin, sid, r, (m.approved_by as string) ?? null);
        if (!pub) { await back("failed", "Could not save the update snapshot"); continue; }
        publicationId = pub.id;
        const final = await renderUpdate(admin, sid, { link: pub.link, milestoneTaskId: (m.task_id as string) ?? null, postalAddress: settings.postalAddress, unsubscribeUrl: unsub.page, now });
        subject = final?.subject ?? r.subject; body = final?.body ?? r.body; content = { report: r.report, options: r.options, revision: r.revision };
      }

      const rfc = newRfcMessageId();
      const replyToken = cfg.replyDomain ? newReplyToken() : null;
      const replyTo = replyToken ? replyAddress(replyToken, cfg.replyDomain!) : settings.replyTo || brand.email;
      await admin.from("comm_messages").update({ subject, body_text: body, content, rfc_message_id: rfc, reply_token: replyToken, publication_id: publicationId }).eq("id", id);
      const res = await sendCommEmail(cfg.apiKey, {
        idempotencyKey: `comm/${id}`, from: fromHeader(settings.senderName || brand.companyName, cfg.fromAddress), to, replyTo: replyTo ?? null, subject, text: body, messageId: rfc,
        unsubscribe: m.kind === "nurture" || m.kind === "project_update" ? { oneClick: unsub.oneClick } : null,
        tags: [{ name: "kind", value: String(m.kind) }, { name: "message", value: id }],
      });
      if (res.ok) {
        await admin.from("comm_messages").update({ status: "sent", sent_at: iso(new Date()), provider_id: res.id, status_reason: null, last_error: null, locked_until: null }).eq("id", id);
        if (m.contact_id) await admin.from("comm_contacts").update({ last_nurture_at: iso(new Date()) }).eq("id", String(m.contact_id));
        await logEvent(admin, { accountId, kind: "sent", messageId: id, contactId: (m.contact_id as string) ?? null, details: { provider: "resend", providerId: res.id } });
        out.sent = (out.sent ?? 0) + 1;
        total++;
      } else {
        const final = !res.retry || Number(m.attempts) + 1 >= 5;
        await admin.from("comm_messages").update({ status: "failed", last_error: res.error, status_reason: final ? "Sending failed" : "Sending failed; will retry", locked_until: null, ...(final ? { attempts: 5 } : {}) }).eq("id", id);
        await logEvent(admin, { accountId, kind: "failed", messageId: id, details: { error: res.error, final } });
        out.failed = (out.failed ?? 0) + 1;
      }
    } catch (e) {
      logError("comms.deliver", e, { message: id });
      await back("failed", "Unexpected error; will retry");
    }
  }
}

/** Hourly job. Emergency stop and COMM_EMAIL_MODE=off both mean nothing is planned or sent. */
export async function runComms(admin: Db, opts: { now?: Date; config?: CommConfig } = {}) {
  const now = opts.now ?? new Date();
  const cfg = opts.config ?? commConfig();
  const out: Record<string, number> = {};
  const { data: g } = await admin.from("comm_global").select("paused, inbound_verified_at").eq("id", 1).maybeSingle();
  if (!g) return { ok: false, reason: "migration not applied", ...out };
  if ((g as Row).paused) return { ok: true, paused: true, ...out };
  if (!cfg.enabled) return { ok: true, off: cfg.reason, ...out };
  const monitoring = replyMonitoring(cfg, ((g as Row).inbound_verified_at as string) ?? null);
  await planProjectUpdates(admin, now, out);
  await sendReminders(admin, now, out);
  await planNurture(admin, now, cfg, monitoring.active, out);
  await planFinancialReminders(admin, now, out);
  await deliverDue(admin, now, cfg, monitoring.active, out);
  return { ok: true, ...out };
}

export { accountOwner };
