"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin/server";
import { MANUAL_STAGES, isStage } from "@/lib/creator/crm";
import { parseDrafts, parseSeed } from "@/lib/creator/outreach/import";
import { recordReply } from "@/lib/creator/outreach/replies";
import { REPLY_LABELS, type ReplyClass } from "@/lib/creator/outreach/classify";
import { unresolvedPlaceholders } from "@/lib/creator/outreach/templates";
import { ProgramInput, TermsInput, creatorErrorMessage } from "@/lib/creator/program";
import { inviteUrl, newInviteToken } from "@/lib/comp/server";

/**
 * Owner-only Creator Partnerships actions. Each re-runs requireAdmin() (404 for anyone else) and uses
 * the service role only after that. Nothing here sends email: approving a message only queues it for
 * the scheduler, which itself is off until sending is approved in Settings and enabled on the server.
 */
const BASE = "/admin/creators";
const Id = z.string().uuid();
const back = (path: string, kind: "msg" | "err", text: string): never => redirect(`${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(text)}`);
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

async function ev(db: Awaited<ReturnType<typeof requireAdmin>>["db"], prospectId: string, kind: string, actor: string, details: Record<string, unknown> = {}) {
  await db.from("creator_outreach_events").insert({ prospect_id: prospectId, kind, actor_id: actor, details });
}

/** Import creators_seed.json (+ optional outreach_drafts.md). Upserts by channel id; never overwrites outreach state. */
export async function importResearch(form: FormData) {
  const { user, db } = await requireAdmin();
  const seedFile = form.get("seed");
  const draftsFile = form.get("drafts");
  if (!(seedFile instanceof File) || seedFile.size === 0) back(BASE, "err", "Choose the creators_seed.json file.");
  if ((seedFile as File).size > 2_000_000) back(BASE, "err", "That file is too large (2 MB max).");
  let parsed;
  try { parsed = parseSeed(JSON.parse(await (seedFile as File).text())); } catch { return back(BASE, "err", "That file isn't a valid creators_seed.json."); }
  const drafts = draftsFile instanceof File && draftsFile.size > 0 && draftsFile.size < 1_000_000 ? parseDrafts(await draftsFile.text()) : [];
  let created = 0, updated = 0, draftsAdded = 0;
  for (const p of parsed.prospects) {
    const q = p.channel_id ? db.from("creator_prospects").select("id, stage").eq("channel_id", p.channel_id) : db.from("creator_prospects").select("id, stage").ilike("channel_name", p.channel_name);
    const { data: existing } = await q.maybeSingle();
    let id = existing?.id as string | undefined;
    if (existing) {
      await db.from("creator_prospects").update(p).eq("id", existing.id);
      updated++;
    } else {
      const { data, error } = await db.from("creator_prospects").insert({ ...p, stage: p.waitlist ? "researched" : "qualified" }).select("id").single();
      if (error) continue;
      id = data.id; created++;
      await ev(db, data.id, "note", user.id, { imported: true, sources: p.sources.length });
    }
    const draft = p.rank ? drafts.find((d) => d.rank === p.rank) : undefined;
    if (id && draft && p.contact_email) {
      const { error } = await db.from("creator_outreach_messages").insert({ prospect_id: id, kind: "initial", to_email: p.contact_email, subject: draft.subject, body_text: draft.body, status: "draft" });
      if (!error) {
        draftsAdded++;
        await db.from("creator_prospects").update({ stage: "draft_ready" }).eq("id", id).in("stage", ["researched", "qualified"]);
        await ev(db, id, "draft", user.id, { source: "import" });
      }
    }
  }
  await db.from("audit_logs").insert({ actor_id: user.id, action: "creator_crm.import", target_type: "creator_prospects", target_id: "import", details: { created, updated, drafts: draftsAdded, skipped: parsed.skipped.length } });
  revalidatePath(BASE);
  back(BASE, "msg", `Imported ${created} new and updated ${updated} creators${draftsAdded ? `, with ${draftsAdded} outreach drafts` : ""}. Nothing was sent.`);
}

export async function saveDraft(form: FormData) {
  const { user, db } = await requireAdmin();
  const id = str(form, "prospect_id");
  if (!Id.safeParse(id).success) back(BASE, "err", "Unknown creator.");
  const path = `${BASE}/${id}`;
  const subject = str(form, "subject").slice(0, 200);
  const body = str(form, "body").slice(0, 6000);
  if (!subject || body.length < 20) back(path, "err", "Write a subject and the email body.");
  const { data: p } = await db.from("creator_prospects").select("id, contact_email, stage").eq("id", id).maybeSingle();
  if (!p) back(BASE, "err", "Unknown creator.");
  const { data: existing } = await db.from("creator_outreach_messages").select("id, status").eq("prospect_id", id).eq("kind", "initial").neq("status", "cancelled").maybeSingle();
  if (existing && existing.status !== "draft") back(path, "err", "This email was already approved or sent. Cancel it first to edit.");
  if (existing) await db.from("creator_outreach_messages").update({ subject, body_text: body, to_email: p!.contact_email }).eq("id", existing.id);
  else await db.from("creator_outreach_messages").insert({ prospect_id: id, kind: "initial", to_email: p!.contact_email, subject, body_text: body, status: "draft" });
  await db.from("creator_prospects").update({ stage: "draft_ready" }).eq("id", id).in("stage", ["researched", "qualified"]);
  await ev(db, id, "draft", user.id);
  revalidatePath(path);
  back(path, "msg", "Draft saved. Nothing was sent.");
}

/** Owner approval of ONE initial email. Queues it; the scheduler sends only when sending is enabled. */
export async function approveDraft(form: FormData) {
  const { user, db } = await requireAdmin();
  const id = str(form, "prospect_id");
  if (!Id.safeParse(id).success) back(BASE, "err", "Unknown creator.");
  const path = `${BASE}/${id}`;
  if (form.get("confirm") !== "on") back(path, "err", "Confirm you approve this exact message and recipient.");
  const { data: p } = await db.from("creator_prospects").select("id, contact_email, contact_source_url, stage").eq("id", id).maybeSingle();
  if (!p?.contact_email || !p.contact_source_url) back(path, "err", "A verified, publicly published business email with its source URL is required before approval.");
  const { data: m } = await db.from("creator_outreach_messages").select("id, subject, body_text, status").eq("prospect_id", id).eq("kind", "initial").eq("status", "draft").maybeSingle();
  if (!m) back(path, "err", "There's no draft to approve.");
  const holes = unresolvedPlaceholders(`${m!.subject}\n${m!.body_text}`);
  if (holes.length) back(path, "err", `Fill in the placeholders first: ${holes.join(", ")}`);
  const { data: sup } = await db.from("creator_outreach_suppressions").select("email").eq("email", p!.contact_email).maybeSingle();
  if (sup) back(path, "err", "This address is on the do-not-email list.");
  const { error } = await db.from("creator_outreach_messages").update({ status: "approved", approved_by: user.id, approved_at: new Date().toISOString(), to_email: p!.contact_email }).eq("id", m!.id).eq("status", "draft");
  if (error) back(path, "err", "Could not approve this message.");
  await db.from("creator_prospects").update({ stage: "approved" }).eq("id", id);
  await ev(db, id, "approved", user.id, { message_id: m!.id, to: p!.contact_email });
  await db.from("audit_logs").insert({ actor_id: user.id, action: "creator_outreach.approve", target_type: "creator_prospect", target_id: id, details: { message_id: m!.id } });
  revalidatePath(path);
  back(path, "msg", "Approved and queued. It sends only after outreach sending is approved and switched on in Settings.");
}

export async function cancelMessage(form: FormData) {
  const { user, db } = await requireAdmin();
  const id = str(form, "prospect_id");
  const messageId = str(form, "message_id");
  if (!Id.safeParse(id).success || !Id.safeParse(messageId).success) back(BASE, "err", "Unknown message.");
  const path = `${BASE}/${id}`;
  await db.from("creator_outreach_messages").update({ status: "cancelled", last_error: "cancelled by owner" }).eq("id", messageId).eq("prospect_id", id).in("status", ["draft", "approved", "failed"]);
  await db.from("creator_prospects").update({ stage: "qualified" }).eq("id", id).in("stage", ["draft_ready", "approved"]);
  await ev(db, id, "note", user.id, { cancelled_message: messageId });
  revalidatePath(path);
  back(path, "msg", "Cancelled.");
}

export async function logReply(form: FormData) {
  const { user, db } = await requireAdmin();
  const id = str(form, "prospect_id");
  if (!Id.safeParse(id).success) back(BASE, "err", "Unknown creator.");
  const path = `${BASE}/${id}`;
  const c = str(form, "classification");
  const classification = c && c in REPLY_LABELS ? (c as ReplyClass) : undefined;
  const r = await recordReply(db, { prospectId: id, text: str(form, "text").slice(0, 5000), subject: str(form, "subject"), classification, actorId: user.id });
  revalidatePath(path);
  back(path, "msg", `Reply logged as "${REPLY_LABELS[r.classification]}". Pending follow-ups were cancelled.`);
}

export async function setStage(form: FormData) {
  const { user, db } = await requireAdmin();
  const id = str(form, "prospect_id");
  const stage = str(form, "stage");
  if (!Id.safeParse(id).success) back(BASE, "err", "Unknown creator.");
  const path = `${BASE}/${id}`;
  if (!isStage(stage) || !MANUAL_STAGES.includes(stage)) back(path, "err", "That status is set automatically.");
  if (stage === "accepted" && str(form, "evidence").length < 10) back(path, "err", "Accepted means the creator explicitly agreed to the program terms. Describe that acceptance (casual interest isn't enough).");
  const { data: p } = await db.from("creator_prospects").select("stage").eq("id", id).maybeSingle();
  await db.from("creator_prospects").update({ stage }).eq("id", id);
  await ev(db, id, "stage", user.id, { from: p?.stage, to: stage, evidence: stage === "accepted" ? str(form, "evidence").slice(0, 1000) : undefined });
  if (["accepted", "declined", "interested", "questions"].includes(stage)) {
    await db.from("creator_outreach_messages").update({ status: "cancelled", last_error: `stage: ${stage}` }).eq("prospect_id", id).in("status", ["approved", "failed"]).eq("kind", "follow_up");
  }
  revalidatePath(path);
  back(path, "msg", "Status updated.");
}

export async function addNote(form: FormData) {
  const { user, db } = await requireAdmin();
  const id = str(form, "prospect_id");
  if (!Id.safeParse(id).success) back(BASE, "err", "Unknown creator.");
  const note = str(form, "note").slice(0, 2000);
  if (note) await ev(db, id, "note", user.id, { note });
  revalidatePath(`${BASE}/${id}`);
  back(`${BASE}/${id}`, "msg", "Note added.");
}

export async function updateContact(form: FormData) {
  const { user, db } = await requireAdmin();
  const id = str(form, "prospect_id");
  if (!Id.safeParse(id).success) back(BASE, "err", "Unknown creator.");
  const path = `${BASE}/${id}`;
  const email = str(form, "contact_email").toLowerCase();
  const source = str(form, "contact_source_url");
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) back(path, "err", "Enter a valid email.");
  if (email && !/^https:\/\//.test(source)) back(path, "err", "Every contact needs the https:// page where the creator published it.");
  const { error } = await db.from("creator_prospects").update({ contact_email: email || null, contact_source_url: source || null, contact_verified_at: email ? new Date().toISOString().slice(0, 10) : null, gift_tier: str(form, "gift_tier") === "10" ? 10 : 5 }).eq("id", id);
  if (error) back(path, "err", error.code === "23505" ? "Another creator already uses that email." : "Could not save.");
  await db.from("creator_outreach_messages").update({ to_email: email || null }).eq("prospect_id", id).eq("status", "draft");
  await ev(db, id, "note", user.id, { contact_updated: Boolean(email) });
  revalidatePath(path);
  back(path, "msg", "Contact saved.");
}

export async function reserveSlot(form: FormData) {
  const { user, db } = await requireAdmin();
  const id = str(form, "prospect_id");
  const slot = str(form, "slot_id");
  if (!Id.safeParse(id).success || !Id.safeParse(slot).success) back(BASE, "err", "Unknown slot.");
  const path = `${BASE}/${id}`;
  const { data, error } = await db.from("creator_cohort_slots").update({ reserved_prospect_id: id, reserved_at: new Date().toISOString() }).eq("id", slot).is("reserved_prospect_id", null).select("id, cohort");
  if (error || !data?.length) back(path, "err", "That slot is taken, or this creator already holds one.");
  await db.from("creator_prospects").update({ cohort: data![0].cohort }).eq("id", id);
  await ev(db, id, "slot_reserved", user.id, { slot_id: slot, reason: "owner" });
  revalidatePath(path);
  back(path, "msg", "Partnership slot reserved.");
}

export async function releaseSlot(form: FormData) {
  const { user, db } = await requireAdmin();
  const id = str(form, "prospect_id");
  if (!Id.safeParse(id).success) back(BASE, "err", "Unknown creator.");
  await db.from("creator_cohort_slots").update({ reserved_prospect_id: null, reserved_at: null }).eq("reserved_prospect_id", id);
  await ev(db, id, "slot_released", user.id, { reason: "owner" });
  revalidatePath(`${BASE}/${id}`);
  back(`${BASE}/${id}`, "msg", "Slot released.");
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
export async function saveSettings(form: FormData) {
  const { user, db } = await requireAdmin();
  const path = `${BASE}/settings`;
  const num = (k: string, min: number, max: number, d: number) => { const n = Number(str(form, k)); return Number.isInteger(n) && n >= min && n <= max ? n : d; };
  const email = (k: string) => { const v = str(form, k).toLowerCase(); return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? v : null; };
  const row = {
    sender_name: str(form, "sender_name").slice(0, 120) || null,
    sender_email: email("sender_email"),
    reply_to: email("reply_to"),
    postal_address: str(form, "postal_address").slice(0, 300) || null,
    daily_send_limit: num("daily_send_limit", 1, 100, 10),
    business_hour_start: num("business_hour_start", 0, 23, 9),
    business_hour_end: num("business_hour_end", 1, 24, 17),
    follow_up_hours: num("follow_up_hours", 24, 336, 72),
    cohort_label: str(form, "cohort_label").slice(0, 80) || null,
    cohort_deadline_is_real: form.get("cohort_deadline_is_real") === "on",
  };
  if (row.business_hour_end <= row.business_hour_start) back(path, "err", "Business hours must end after they start.");
  await db.from("creator_outreach_settings").update(row).eq("id", true);
  await db.from("audit_logs").insert({ actor_id: user.id, action: "creator_outreach.settings", target_type: "creator_outreach_settings", target_id: "settings", details: { ...row, postal_address: undefined } });
  revalidatePath(path);
  back(path, "msg", "Settings saved.");
}

export async function saveFollowUpTemplate(form: FormData) {
  const { user, db } = await requireAdmin();
  const path = `${BASE}/settings`;
  const subject = str(form, "follow_up_subject").slice(0, 200);
  const body = str(form, "follow_up_body").slice(0, 6000);
  const approve = form.get("approve") === "on";
  if (!subject || body.length < 40) back(path, "err", "Write the follow-up subject and body.");
  const allowed = ["[First Name]", "[5/10]", "[original subject]", "[Sender Name]", "[DEADLINE]", "[/DEADLINE]"];
  const unknown = (`${subject}\n${body}`.match(/\[[^\]\n]{1,60}\]/g) ?? []).filter((x) => !allowed.includes(x));
  if (unknown.length) back(path, "err", `Unknown placeholders: ${[...new Set(unknown)].join(", ")}`);
  // Any edit withdraws a previous approval: the owner approves the exact text that will go out.
  await db.from("creator_outreach_settings").update({ follow_up_subject: subject, follow_up_body: body, follow_up_approved_at: approve ? new Date().toISOString() : null }).eq("id", true);
  await db.from("audit_logs").insert({ actor_id: user.id, action: approve ? "creator_outreach.follow_up_approved" : "creator_outreach.follow_up_saved", target_type: "creator_outreach_settings", target_id: "settings", details: { subject } });
  revalidatePath(path);
  back(path, "msg", approve ? "Follow-up template saved and approved." : "Follow-up template saved (not approved, so no follow-ups will be created).");
}

/** The owner's switch for the whole sending workflow. Server env must ALSO allow it. */
export async function setSending(form: FormData) {
  const { user, db } = await requireAdmin();
  const path = `${BASE}/settings`;
  const on = form.get("on") === "true";
  if (on && form.get("confirm") !== "on") back(path, "err", "Confirm that you approve the outreach workflow and message templates.");
  await db.from("creator_outreach_settings").update(on ? { sending_enabled: true, approved_by: user.id, approved_at: new Date().toISOString() } : { sending_enabled: false }).eq("id", true);
  await db.from("audit_logs").insert({ actor_id: user.id, action: on ? "creator_outreach.sending_on" : "creator_outreach.sending_off", target_type: "creator_outreach_settings", target_id: "settings", details: {} });
  revalidatePath(path);
  back(path, "msg", on ? "Sending approved. Emails go out only if the server switch is also on." : "Sending switched off. Nothing will be sent.");
}

export async function addSlots(form: FormData) {
  const { user, db } = await requireAdmin();
  const path = `${BASE}/settings`;
  const cohort = str(form, "cohort").slice(0, 80);
  const trade = str(form, "trade").slice(0, 120);
  const count = Math.min(20, Math.max(1, Number(str(form, "count")) || 1));
  const tier = str(form, "gift_tier") === "10" ? 10 : 5;
  if (!cohort || !trade) back(path, "err", "Name the cohort and trade.");
  await db.from("creator_cohort_slots").insert(Array.from({ length: count }, () => ({ cohort, trade, gift_tier: tier })));
  await db.from("audit_logs").insert({ actor_id: user.id, action: "creator_outreach.slots_added", target_type: "creator_cohort_slots", target_id: cohort, details: { trade, count, tier } });
  revalidatePath(path);
  back(path, "msg", `Added ${count} ${trade} slot${count === 1 ? "" : "s"} to ${cohort}.`);
}

export async function removeSlot(form: FormData) {
  const { user, db } = await requireAdmin();
  const path = `${BASE}/settings`;
  const id = str(form, "slot_id");
  if (!Id.safeParse(id).success) back(path, "err", "Unknown slot.");
  const { data } = await db.from("creator_cohort_slots").delete().eq("id", id).is("reserved_prospect_id", null).select("id");
  if (!data?.length) back(path, "err", "Release the slot before removing it.");
  await db.from("audit_logs").insert({ actor_id: user.id, action: "creator_outreach.slot_removed", target_type: "creator_cohort_slots", target_id: id, details: {} });
  revalidatePath(path);
  back(path, "msg", "Slot removed.");
}

// ---------------------------------------------------------------------------
// Learning Enterprise programs
// ---------------------------------------------------------------------------
const PROGRAMS = `${BASE}/programs`;

export async function createProgram(form: FormData) {
  const { user, db } = await requireAdmin();
  const p = ProgramInput.safeParse({
    email: str(form, "email"), workspaceName: str(form, "workspace_name"), channelName: str(form, "channel_name") || undefined,
    channelUrl: str(form, "channel_url"), giftAllowance: str(form, "gift_allowance"), prospectId: str(form, "prospect_id"),
  });
  if (!p.success) back(PROGRAMS, "err", p.error.issues[0]?.message ?? "Check the fields.");
  const v = p.data!;
  const { data, error } = await db.rpc("admin_creator_program_create", {
    p_caller: user.id, p_email: v.email, p_workspace_name: v.workspaceName, p_channel_name: v.channelName ?? null,
    p_channel_url: v.channelUrl || null, p_gift_allowance: v.giftAllowance, p_prospect_id: v.prospectId || null,
  });
  if (error || !data) back(PROGRAMS, "err", creatorErrorMessage(error?.message));
  if (v.prospectId) await db.from("creator_prospects").update({ program_id: data.id }).eq("id", v.prospectId);
  revalidatePath(PROGRAMS);
  back(`${PROGRAMS}/${data.id}`, "msg", "Draft program created. Record the creator's acceptance of the terms before provisioning.");
}

export async function recordTerms(form: FormData) {
  const { user, db } = await requireAdmin();
  const p = TermsInput.safeParse({ id: str(form, "id"), termsVersion: str(form, "terms_version"), evidence: str(form, "evidence"), confirmExplicit: form.get("confirm") === "on" ? true : undefined });
  const path = `${PROGRAMS}/${str(form, "id")}`;
  if (!p.success) back(Id.safeParse(str(form, "id")).success ? path : PROGRAMS, "err", p.error.issues[0]?.message ?? "Check the fields.");
  const { error } = await db.rpc("admin_creator_program_record_terms", { p_caller: user.id, p_id: p.data!.id, p_terms_version: p.data!.termsVersion, p_evidence: p.data!.evidence });
  if (error) back(path, "err", creatorErrorMessage(error.message));
  revalidatePath(path);
  back(path, "msg", "Acceptance recorded.");
}

/**
 * Issue the creator's 12-month complimentary Enterprise grant. Real account provisioning: the owner must
 * tick the confirmation. No invitation email is sent from here; the owner copies the link.
 */
export async function provisionProgram(form: FormData) {
  const { user, db } = await requireAdmin();
  const id = str(form, "id");
  if (!Id.safeParse(id).success) back(PROGRAMS, "err", "Unknown program.");
  const path = `${PROGRAMS}/${id}`;
  if (form.get("confirm") !== "on") back(path, "err", "Confirm you're issuing a real complimentary Enterprise account.");
  const invite = newInviteToken();
  const { data, error } = await db.rpc("admin_creator_program_provision", { p_caller: user.id, p_id: id, p_token_hash: invite.hash });
  if (error || !data) back(path, "err", creatorErrorMessage(error?.message));
  revalidatePath(path);
  if (data.existing_account) back(path, "msg", "Provisioned. The creator already has a verified account, so Enterprise and the Learning Enterprise dashboard are active now.");
  back(path, "msg", `Provisioned. Send the creator this private link (it works only for ${data.creator_email}): ${inviteUrl(invite.token)}`);
}

export async function setAllowance(form: FormData) {
  const { user, db } = await requireAdmin();
  const id = str(form, "id");
  const path = `${PROGRAMS}/${id}`;
  if (!Id.safeParse(id).success) back(PROGRAMS, "err", "Unknown program.");
  const n = Number(str(form, "gift_allowance"));
  const { error } = await db.rpc("admin_creator_program_set_allowance", { p_caller: user.id, p_id: id, p_allowance: Number.isInteger(n) ? n : -1 });
  if (error) back(path, "err", creatorErrorMessage(error.message));
  revalidatePath(path);
  back(path, "msg", "Gift allowance updated.");
}

export async function endProgram(form: FormData) {
  const { user, db } = await requireAdmin();
  const id = str(form, "id");
  const path = `${PROGRAMS}/${id}`;
  if (!Id.safeParse(id).success) back(PROGRAMS, "err", "Unknown program.");
  if (form.get("confirm") !== "on") back(path, "err", "Confirm you want to end this program.");
  const { error } = await db.rpc("admin_creator_program_end", { p_caller: user.id, p_id: id, p_reason: str(form, "reason").slice(0, 500), p_end_gifts: form.get("end_gifts") === "on", p_end_creator_grant: form.get("end_creator_grant") === "on" });
  if (error) back(path, "err", creatorErrorMessage(error.message));
  revalidatePath(path);
  back(path, "msg", "Program ended. Everyone keeps their accounts and business records.");
}
