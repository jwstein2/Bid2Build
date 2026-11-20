"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { hasTwoStep, requireStaffCap } from "@/lib/staff/server";
import { newInviteToken } from "@/lib/sales/invite";
import { ROLES } from "@/lib/payouts/labels";
import { STAFF_ERR as ERR, STAFF_FLASH } from "@/lib/staff/flash";

/**
 * Owner staff management (Administration → Team & Staff). Every function re-checks the owner in the database
 * (staff_require_owner) and writes audit_logs there. Nothing here moves money or sends email: invite links are
 * shown once to the owner to send by hand.
 */
const uuid = z.string().uuid();
const errCode = (m: string | undefined) => (m?.includes("duplicate key") ? "duplicate" : Object.keys(ERR).find((k) => m?.includes(k)) ?? "invalid");

function back(path: string, q: Record<string, string>): never {
  revalidatePath("/admin/staff");
  redirect(`${path}?${new URLSearchParams(q)}`);
}

const dollars = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").replace(/[$,\s]/g, "");
  if (!s) return "";
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n <= 1_000_000 ? String(Math.round(n * 100)) : "";
};

const Form = z.object({
  email: z.string().trim().toLowerCase().email().max(320).optional(),
  display_name: z.string().trim().min(1).max(120).optional(),
  job_title: z.string().trim().max(120).optional(),
  department: z.string().trim().max(80).optional(),
  start_date: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/).optional(),
  end_date: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/).optional(),
  manager_id: z.string().regex(/^([0-9a-f-]{36})?$/).optional(),
  classification: z.enum(["contractor_1099", "employee_w2", "vendor", "pending_review"]),
  classification_note: z.string().trim().max(1000).optional(),
  pay_unit: z.enum(["", "hour", "year", "month", "project"]).optional(),
  pay_frequency: z.enum(["", "weekly", "biweekly", "semimonthly", "monthly", "per_statement"]).optional(),
  work_state: z.string().trim().toUpperCase().regex(/^([A-Z]{2})?$/).optional(),
  payment_method: z.enum(["ach", "check", "payroll"]).optional(),
});

function payload(fd: FormData) {
  const raw = Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === "string").map(([k, v]) => [k, String(v)]));
  const p = Form.safeParse(raw);
  if (!p.success) return null;
  const comp = fd.getAll("comp_types").map(String).filter((x) => ["commission", "hourly", "salary", "fixed_fee", "bonus"].includes(x));
  const roles = fd.getAll("roles").map(String).filter((r) => ROLES.includes(r));
  return { ...p.data, comp_types: comp, roles, pay_rate_cents: dollars(fd.get("pay_rate")), mark_reviewed: fd.get("mark_reviewed") === "on" };
}

export async function createStaff(fd: FormData) {
  const { user, db } = await requireStaffCap("staff.manage");
  const p = payload(fd);
  if (!p || !p.email || !p.display_name) back("/admin/staff", { err: "invalid", new: "1" });
  const { data, error } = await db.rpc("admin_staff_save", { p_caller: user.id, p_id: null, p });
  if (error) back("/admin/staff", { err: errCode(error.message), new: "1" });
  const id = (data as { id: string }).id;
  if (fd.get("invite") === "on") await makeInvite(user.id, id, db);
  back(`/admin/staff/${id}`, { ok: "created" });
}

export async function updateStaff(fd: FormData) {
  const { user, db } = await requireStaffCap("staff.manage");
  const id = uuid.safeParse(fd.get("id"));
  const p = payload(fd);
  if (!id.success || !p) back("/admin/staff", { err: "invalid" });
  const { error } = await db.rpc("admin_staff_save", { p_caller: user.id, p_id: id.data, p });
  back(`/admin/staff/${id.data}`, error ? { err: errCode(error.message) } : { ok: "saved" });
}

async function makeInvite(caller: string, id: string, db: Awaited<ReturnType<typeof requireStaffCap>>["db"]) {
  const t = newInviteToken();
  const { error } = await db.rpc("admin_staff_invite_create", { p_caller: caller, p_id: id, p_token_hash: t.hash, p_days: 7 });
  if (error) back(`/admin/staff/${id}`, { err: errCode(error.message) });
  (await cookies()).set(STAFF_FLASH, `${id}.${t.token}`, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/admin/staff", maxAge: 120 });
}

export async function inviteStaff(fd: FormData) {
  const { user, db } = await requireStaffCap("staff.manage");
  const id = uuid.safeParse(fd.get("id"));
  if (!id.success) back("/admin/staff", { err: "invalid" });
  await makeInvite(user.id, id.data, db);
  back(`/admin/staff/${id.data}`, { ok: "invited" });
}

export async function setStaffStatus(fd: FormData) {
  const { user, db } = await requireStaffCap("staff.manage");
  const id = uuid.safeParse(fd.get("id"));
  const status = String(fd.get("status") ?? "");
  if (!id.success || !["active", "suspended", "terminated"].includes(status)) back("/admin/staff", { err: "invalid" });
  const { error } = await db.rpc("admin_staff_set_status", { p_caller: user.id, p_id: id.data, p_status: status, p_reason: String(fd.get("reason") ?? "").slice(0, 500) });
  back(`/admin/staff/${id.data}`, error ? { err: errCode(error.message) } : { ok: status });
}

export async function setBankingAccess(fd: FormData) {
  const { user, db } = await requireStaffCap("staff.manage");
  const id = uuid.safeParse(fd.get("id"));
  if (!id.success) back("/admin/staff", { err: "invalid" });
  const grant = fd.get("grant") === "1";
  if (grant && !(await hasTwoStep())) back(`/admin/staff/${id.data}`, { err: "two_step" });
  const { error } = await db.rpc("admin_staff_banking_grant", { p_caller: user.id, p_id: id.data, p_grant: grant });
  back(`/admin/staff/${id.data}`, error ? { err: errCode(error.message) } : { ok: grant ? "banking_granted" : "banking_revoked" });
}

export async function verifyTaxItem(fd: FormData) {
  const { user, db } = await requireStaffCap("staff.manage");
  const id = uuid.safeParse(fd.get("id"));
  const item = String(fd.get("item") ?? "");
  if (!id.success || !["w9", "w9_correction", "w4", "state_w4", "state_w4_not_required", "i9_section2", "new_hire_reported"].includes(item)) back("/admin/staff", { err: "invalid" });
  const { error } = await db.rpc("admin_staff_tax_verify", { p_caller: user.id, p_id: id.data, p_item: item, p_date: null });
  back(`/admin/staff/${id.data}`, error ? { err: errCode(error.message) } : { ok: "verified" });
}

