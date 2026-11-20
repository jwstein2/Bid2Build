/** Where a staff sign-in may return to: only pages inside /staff (never the sign-in page itself, never another site). */
export function safeStaffNext(next: string | null | undefined): string {
  if (!next || !/^\/staff([/?#]|$)/.test(next) || next.startsWith("//") || next.includes("\\") || next.startsWith("/staff/login")) return "/staff";
  return next.slice(0, 500);
}
