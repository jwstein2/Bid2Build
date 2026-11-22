"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { hasTwoStep, requireStaffCap } from "@/lib/staff/server";
import { checkPaidBills, disconnectPlatform, platformConnection, sendBills, setExpenseAccount } from "@/lib/quickbooks/platform";
import { logError } from "@/lib/http/api";

/**
 * Owner controls for paying reps and affiliates through Built2Bid's QuickBooks. Creating bills and changing the
 * connection need the owner (payouts.activate) and a two-step session; checking for paid bills only needs payouts.manage.
 */
const back = (q: Record<string, string>): never => { revalidatePath("/admin/payouts"); redirect(`/admin/payouts?${new URLSearchParams({ tab: "quickbooks", ...q })}`); };

async function owner2fa() {
  const a = await requireStaffCap("payouts.activate");
  if (!(await hasTwoStep())) back({ err: "two_step" });
  return a;
}

export async function qbSetAccount(fd: FormData) {
  const { db } = await owner2fa();
  const c = await platformConnection(db);
  const id = String(fd.get("account") ?? "");
  if (!c || !/^\d{1,32}$/.test(id)) back({ err: "invalid" });
  const ok = await setExpenseAccount(db, c!, id).catch((e) => { logError("quickbooks.set_account", e); return false; });
  back(ok ? { ok: "qb_account" } : { err: "qb_failed" });
}

export async function qbSendBills(fd: FormData) {
  const { user, db } = await owner2fa();
  const c = await platformConnection(db);
  if (!c || c.status !== "active") back({ err: "qb_not_connected" });
  const ids = fd.getAll("source").map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 100);
  if (!ids.length) back({ err: "qb_none_selected" });
  if (fd.get("confirm") !== "on") back({ err: "confirm" });
  const r = await sendBills(db, c!, user.id, ids).catch((e) => { logError("quickbooks.send_bills", e); return { created: 0, failed: ids.length, skipped: 0, errors: [(e as Error).message] }; });
  back({ ok: "qb_sent", summary: `${r.created} bill(s) created${r.failed ? `, ${r.failed} failed` : ""}${r.skipped ? `, ${r.skipped} skipped` : ""}.${r.errors.length ? ` ${r.errors.slice(0, 3).join(" · ")}` : ""}`.slice(0, 600) });
}

export async function qbCheckPaid() {
  const { db } = await requireStaffCap("payouts.manage");
  const r = await checkPaidBills(db).catch((e) => { logError("quickbooks.check_paid", e); return null; });
  if (!r) back({ err: "qb_failed" });
  back(r!.skipped ? { err: "qb_not_connected" } : { ok: "qb_checked", summary: `${r!.checked} open bill(s) checked, ${r!.paid} paid${r!.voided ? `, ${r!.voided} deleted in QuickBooks` : ""}.` });
}

export async function qbDisconnect(fd: FormData) {
  const { db } = await owner2fa();
  if (fd.get("confirm") !== "on") back({ err: "confirm" });
  await disconnectPlatform(db);
  back({ ok: "qb_disconnected" });
}
