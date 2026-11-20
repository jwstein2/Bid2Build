"use server";
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createAdminClient, createClient, getUser } from "@/lib/supabase/server";
import { normalizeTaxId, piiReady, sealPii } from "@/lib/security/pii";
import { hasTwoStep } from "@/lib/staff/server";

/**
 * Staff self-service onboarding. Self functions run with the person's own session (auth.uid()), so nobody can edit
 * another person's record. The W-9 TIN is sealed on the server (AES-256-GCM) before it reaches the database and is
 * never logged; only the last 4 are stored in the app tables.
 */
const go = (step: string, q: Record<string, string> = {}): never => { revalidatePath("/staff"); redirect(`/staff/onboarding?${new URLSearchParams({ step, ...q })}`); };
const s = (fd: FormData, k: string, max = 200) => String(fd.get(k) ?? "").trim().slice(0, max);

export async function saveProfile(fd: FormData) {
  const db = await createClient();
  const p = Object.fromEntries(["legal_first_name", "legal_last_name", "preferred_name", "phone", "address_line1", "address_line2", "city", "state", "postal_code", "country",
    "emergency_name", "emergency_phone", "emergency_relation"].map((k) => [k, s(fd, k)]));
  if (!p.legal_first_name || !p.legal_last_name || !p.phone || !p.address_line1 || !p.city || !p.state || !p.postal_code) go("personal", { err: "required" });
  const { error } = await db.rpc("staff_my_profile_save", { p });
  go(error ? "personal" : "role", error ? { err: "save" } : {});
}

export async function confirmRole() {
  const { error } = await (await createClient()).rpc("staff_my_role_confirm");
  go(error ? "role" : "agreements", error ? { err: "pending" } : {});
}

export async function acceptAgreement(fd: FormData) {
  const db = await createClient();
  const { data: me } = await db.rpc("staff_me");
  const a = ((me as { required_agreements?: { id: string; body: string }[] } | null)?.required_agreements ?? []).find((x) => x.id === s(fd, "id", 40));
  if (!a || fd.get("agree") !== "on" || s(fd, "typed_name").length < 2) return go("agreements", { err: "agree" });
  const h = await headers();
  const { error } = await db.rpc("staff_my_agreement_accept", { p_template: a.id, p_body_sha256: createHash("sha256").update(a.body, "utf8").digest("hex"),
    p_typed_name: s(fd, "typed_name", 120), p_ip: (h.get("x-forwarded-for") ?? "").split(",")[0].trim().slice(0, 64) || null, p_user_agent: (h.get("user-agent") ?? "").slice(0, 300) });
  go("agreements", error ? { err: "agree" } : { ok: "1" });
}

export async function submitW9(fd: FormData) {
  const user = await getUser();
  if (!user) redirect("/staff/login?next=/staff/onboarding");
  if (!piiReady()) go("tax", { err: "pii" });
  const tinType = s(fd, "tin_type", 4);
  const tin = normalizeTaxId(fd.get("tin"));
  const cls = s(fd, "tax_class", 20);
  if (!tin || !["ssn", "ein", "itin"].includes(tinType) || !["individual", "c_corp", "s_corp", "partnership", "trust_estate", "llc_c", "llc_s", "llc_p", "other"].includes(cls)
      || fd.get("certify") !== "on" || s(fd, "signed_name").length < 2 || s(fd, "legal_name").length < 2) return go("tax", { err: "w9" });
  // Service role on purpose: the TIN secret table has no grants for signed-in users. p_user is this verified session's user.
  const { error } = await createAdminClient().rpc("staff_w9_store", { p_user: user.id, p_legal_name: s(fd, "legal_name"), p_business_name: s(fd, "business_name"), p_tax_class: cls,
    p_exempt_code: s(fd, "exempt_code", 4), p_tin_type: tinType, p_tin_last4: tin.slice(-4), p_tin_ciphertext: sealPii(tin), p_signed_name: s(fd, "signed_name", 120) });
  go(error ? "tax" : "payout", error ? { err: "w9" } : {});
}

export async function employmentItem(fd: FormData) {
  const item = s(fd, "item", 20);
  const { error } = await (await createClient()).rpc("staff_my_employment_item", { p_item: item });
  go("tax", error ? { err: "save" } : {});
}

export async function paymentMethod(fd: FormData) {
  const { error } = await (await createClient()).rpc("staff_my_payment_method", { p_method: s(fd, "method", 10) });
  go(error ? "payout" : "security", error ? { err: "save" } : {});
}

export async function confirmSecurity() {
  const user = await getUser();
  if (!user) redirect("/staff/login?next=/staff/onboarding");
  if (!(await hasTwoStep())) go("security", { err: "two_step" });
  await createAdminClient().rpc("staff_security_confirm", { p_user: user.id });
  go("confirm");
}

export async function finish() {
  const { error } = await (await createClient()).rpc("staff_my_finish");
  if (error) go("confirm", { err: "incomplete" });
  revalidatePath("/staff");
  redirect("/staff?ok=onboarded");
}
