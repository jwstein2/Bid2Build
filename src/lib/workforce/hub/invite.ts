/** V8.3.1 worker app invites: email copy and error messages (pure). */
export interface InviteStatus {
  resourceId: string; kind: string; linked: boolean; email: string | null; phone: string | null; company: boolean; canInvite: boolean;
  pending: { id: string; email: string; expiresAt: string } | null;
}
export function mapInviteStatus(x: unknown): InviteStatus {
  const o = (x ?? {}) as Record<string, unknown>;
  const p = o.pending as Record<string, unknown> | null | undefined;
  const s = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    resourceId: String(o.resourceId ?? ""), kind: String(o.kind ?? "staff"), linked: o.linked === true, email: s(o.email), phone: s(o.phone),
    company: o.company === true, canInvite: o.canInvite === true,
    pending: p ? { id: String(p.id), email: String(p.email), expiresAt: String(p.expiresAt) } : null,
  };
}

const ERRORS: [string, number, string][] = [
  ["company_required", 400, "Inviting workers needs a Team (company) account. Workers get their own login inside your company."],
  ["already_linked", 409, "This person already has a login. They can open My work now."],
  ["login_in_use", 409, "That person's login is already linked to another staff record."],
  ["staff_only", 400, "Only staff (employees) get the worker app. Subcontractors use their own document links."],
  ["archived", 400, "This staff record is archived. Restore it first."],
  ["invalid_email", 400, "Enter a valid email address."],
  ["no_seats_available", 409, "All your licensed seats are in use. Add a license on Billing & Licenses, or deactivate someone first."],
];
export function inviteError(message: string | undefined): { status: number; code: string; message: string } | null {
  const m = message ?? "";
  const hit = ERRORS.find(([code]) => m.includes(code));
  return hit ? { status: hit[1], code: hit[0], message: hit[2] } : null;
}

export function workerInviteEmail({ companyName, workerName, link, expiresAt }: { companyName: string; workerName: string; link: string; expiresAt: string }) {
  const until = new Date(expiresAt).toLocaleDateString("en-US", { month: "long", day: "numeric" });
  const first = workerName.trim().split(/\s+/)[0] || "there";
  return {
    subject: `${companyName} invited you to the Built2Bid worker app`,
    text: `Hi ${first},\n\n${companyName} uses Built2Bid for schedules and time. Open this link on your phone to set up your login (it works until ${until}):\n\n${link}\n\nAfter you sign in you'll land on My work: today's jobs, your week, and the time clock. Tip: add it to your phone's Home Screen so it's one tap away.\n\nThere's nothing to pay. Your company provides your login.`,
  };
}

export function workerInviteText(companyName: string, link: string): string {
  return `${companyName} invited you to the Built2Bid worker app for your schedule and time clock. Set up your login here: ${link}`;
}
