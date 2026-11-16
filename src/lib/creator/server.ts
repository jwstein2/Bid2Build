import "server-only";
import { hashInviteToken, newInviteToken } from "../comp/server";
import { site } from "../site";

export { hashInviteToken, newInviteToken };

/** Page a gifted subscriber opens (signed-in with the invited, verified email) to accept. */
export const giftPath = (token: string) => `/gift?token=${encodeURIComponent(token)}`;
export const giftUrl = (token: string, origin = site.url) => new URL(giftPath(token), origin).toString();
export const isTokenShape = (t: string) => /^[A-Za-z0-9_-]{20,100}$/.test(t);
