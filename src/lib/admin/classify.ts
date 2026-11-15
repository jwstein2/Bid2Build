/**
 * Genuine vs internal/test/demo account classification. One rule set used by every owner report.
 *
 * Order (first match wins):
 *   1. The owner's manual label (public.admin_account_labels), if any.
 *   2. A platform admin/support role (public.admin_roles) -> internal.
 *   3. An email on a reserved test domain (RFC 2606/6761: .test, .example, .invalid, .localhost,
 *      example.com/.net/.org) or a scripted Stripe test address (stripe-test-...) -> test.
 *   4. Otherwise genuine.
 * Company or business names are never used: a real contractor can be called "Demo Roofing".
 */
export type AccountClass = "genuine" | "internal" | "test" | "demo";
export const ACCOUNT_CLASSES: AccountClass[] = ["genuine", "internal", "test", "demo"];
export const CLASS_LABEL: Record<AccountClass, string> = { genuine: "Genuine", internal: "Internal (owner/staff)", test: "Test", demo: "Demo" };

export interface Classification { cls: AccountClass; reason: string; manual: boolean }

const TEST_TLD = /\.(test|example|invalid|localhost)$/i;
const TEST_DOMAINS = new Set(["example.com", "example.net", "example.org"]);

export function isReservedTestEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 1) return false;
  const local = e.slice(0, at), domain = e.slice(at + 1);
  return TEST_TLD.test(domain) || TEST_DOMAINS.has(domain) || local.startsWith("stripe-test-");
}

export function classifyAccount(email: string | null | undefined, opts: { label?: string | null; isAdmin?: boolean }): Classification {
  if (opts.label && (ACCOUNT_CLASSES as string[]).includes(opts.label)) return { cls: opts.label as AccountClass, reason: "Marked by the owner", manual: true };
  if (opts.isAdmin) return { cls: "internal", reason: "Has a platform admin role", manual: false };
  if (isReservedTestEmail(email)) return { cls: "test", reason: "Email on a reserved test domain", manual: false };
  return { cls: "genuine", reason: "No test signal", manual: false };
}
