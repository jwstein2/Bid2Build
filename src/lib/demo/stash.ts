/** Session stash cookie values (a refresh token plus whose it is). Shared by the proxy and server code; no I/O. */
export interface SessionStash { rt: string; uid: string }

export const encodeStash = (s: SessionStash) => Buffer.from(JSON.stringify(s)).toString("base64url");

export function decodeStash(v: string | undefined | null): SessionStash | null {
  if (!v) return null;
  try {
    const s = JSON.parse(Buffer.from(v, "base64url").toString("utf8")) as Partial<SessionStash>;
    return typeof s.rt === "string" && typeof s.uid === "string" ? { rt: s.rt, uid: s.uid } : null;
  } catch { return null; }
}
