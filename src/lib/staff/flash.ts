/** Cookie that carries a just-created staff invite link ("<staff id>.<token>") to the owner's page for two minutes. */
export const STAFF_FLASH = "b2b_staff_invite";

export function parseStaffFlash(v: string | undefined): { id: string; token: string } | null {
  const m = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/i.exec(v ?? "");
  return m ? { id: m[1], token: m[2] } : null;
}

export const STAFF_ERR: Record<string, string> = {
  duplicate: "That email is already in the staff directory.", owner_only: "Only the platform owner can do that.", not_found: "That person wasn't found.",
  cannot_activate: "Only suspended or onboarding people can be activated.", not_invitable: "Suspended or terminated people can't be invited.",
  two_step: "This needs two-step sign-in (Account settings → Two-step sign-in).", manager_self: "Someone can't be their own manager.", invalid: "Please check the form and try again.",
};
