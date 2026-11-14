/** Maps the company RPCs' error names (raised in SQL) to HTTP status and plain-language messages. */
const MESSAGES: Record<string, [number, string]> = {
  forbidden: [403, "You don't have permission to do that."],
  forbidden_permission: [403, "You can only give out permissions you have yourself. Billing and user management can only be granted by the company owner."],
  cannot_change_self: [403, "You can't change your own role, permissions or status."],
  cannot_change_owner: [403, "The company owner's access can't be changed."],
  invalid_role: [400, "Choose a valid role."],
  invalid_permission: [400, "Unknown permission."],
  invalid_status: [400, "Unknown status."],
  invalid_email: [400, "Enter a valid email address."],
  member_not_found: [404, "That person isn't in your company."],
  team_not_found: [404, "That team doesn't exist."],
  already_member: [409, "That person is already an active member of your company."],
  already_in_company: [409, "That person already belongs to a company account."],
  no_seats_available: [409, "All your licensed seats are in use. Add licenses on Billing & Licenses, or deactivate someone first."],
  not_a_member: [403, "You're not part of a company account."],
  invitation_invalid: [410, "This invitation has expired, was replaced by a newer one, or was already used."],
  invitation_email_mismatch: [403, "This invitation was sent to a different email address. Sign in with the invited email (verified) to accept it."],
  invalid_stage: [400, "Choose a valid pipeline stage."],
  estimate_not_found: [404, "That bid isn't available to you."],
  approval_required: [409, "This bid needs approval before it can be marked Sent. Ask a manager or the owner to approve it."],
  use_set_estimate_stage: [409, "Change the stage from Bids & Pipeline."],
  no_verified_email: [409, "This person has no verified email address on their account."],
};

export function companyRpcError(error: { message?: string; code?: string } | null): { status: number; code: string; message: string } {
  const msg = error?.message ?? "";
  const key = Object.keys(MESSAGES).find((k) => msg === k || msg.includes(k));
  if (key) return { status: MESSAGES[key][0], code: key, message: MESSAGES[key][1] };
  if (error?.code === "23505") return { status: 409, code: "duplicate", message: "That already exists." };
  return { status: 500, code: "company_error", message: "Something went wrong. Please try again." };
}
