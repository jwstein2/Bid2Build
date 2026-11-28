// Provider adapter contract. Every platform/provider pair implements this.
export type Kind = "post" | "reel" | "story";

export interface SubmitInput {
  idempotencyKey: string;          // content_key:attempt
  channelId: string;               // provider's channel / page id
  kind: Kind;
  caption: string;
  linkUrl?: string | null;
  publishAt: Date;                 // UTC instant
  publishNow: boolean;             // slot is < 15 min away
  media?: { type: "image" | "video"; url: string; aiGenerated: boolean } | null;
}

export type SubmitResult =
  | { outcome: "accepted"; providerPostId: string }
  | { outcome: "rejected"; code: string; detail: string }   // permanent: do not retry
  | { outcome: "error"; code: string; detail: string }      // transient: retry with backoff
  | { outcome: "timeout"; code: string; detail: string };   // unknown: verify before any resend

export type StatusResult =
  | { state: "published"; url?: string; publishedAt?: Date; providerPostId?: string }
  | { state: "scheduled"; providerPostId?: string }
  | { state: "error"; detail: string }
  | { state: "not_found" };

export interface Capabilities {
  kinds: Kind[];
  media: { image: boolean; video: boolean };
  video: { minSeconds: number; maxSeconds: number; aspect: string; maxBytes?: number };
  scheduling: { minLeadMinutes: number; maxLeadDays: number };
  auth: string;
  aiLabel: "supported" | "unknown" | "unsupported";
  notes: string[];
}

export interface Provider {
  name: "buffer" | "meta" | "mock";
  capabilities: Capabilities;
  submit(input: SubmitInput): Promise<SubmitResult>;
  // Look up by our own key/caption+time when we lost the response (timeout) — avoids duplicates.
  findExisting(input: { channelId: string; caption: string; publishAt: Date }): Promise<string | null>;
  status(input: { channelId: string; providerPostId: string | null; caption: string; publishAt: Date }): Promise<StatusResult>;
  remove(providerPostId: string): Promise<void>;
  health(channelId: string): Promise<{ ok: boolean; detail: string }>;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

// Fetch with a hard timeout; a timeout is reported distinctly from an error.
export class TimeoutError extends Error {}
export async function fetchWithTimeout(f: FetchLike, url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await f(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new TimeoutError(`no response within ${ms} ms`);
    throw e;
  } finally {
    clearTimeout(t);
  }
}

// Same caption check used by every adapter when looking a post up after a lost response.
export function sameCaption(a: string, b: string): boolean {
  const n = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 200);
  return n(a) === n(b);
}
