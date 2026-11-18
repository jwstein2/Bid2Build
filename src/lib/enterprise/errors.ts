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
  use_set_estimate_stage: [409, "Change the stage from Team bids."],
  bid_signed: [409, "This bid was e-signed, so it stays Won or later. Move it to Lost / Declined if the job was cancelled."],
  not_won: [409, "Mark the bid Approved / Won before scheduling the job."],
  invalid_date: [400, "Choose a date that isn't in the future."],
  no_verified_email: [409, "This person has no verified email address on their account."],
  // V6.7 workspace access
  locked_by_owner: [403, "The primary account holder locked part of this access. Only they can change it."],
  owner_only: [403, "Only the primary account holder can change company-wide access policies."],
  invalid_profile: [400, "That access setup isn't valid. Reload the page and try again."],
  member_inactive: [409, "Reactivate this person before changing their access."],
};

export function companyRpcError(error: { message?: string; code?: string } | null): { status: number; code: string; message: string } {
  const msg = error?.message ?? "";
  // Exact name first ("forbidden_permission" must not read as "forbidden"), then the longest contained name.
  const key = Object.keys(MESSAGES).find((k) => msg === k) ?? Object.keys(MESSAGES).filter((k) => msg.includes(k)).sort((a, b) => b.length - a.length)[0];
  if (key) return { status: MESSAGES[key][0], code: key, message: MESSAGES[key][1] };
  if (error?.code === "23505") return { status: 409, code: "duplicate", message: "That already exists." };
  return { status: 500, code: "company_error", message: "Something went wrong. Please try again." };
}
