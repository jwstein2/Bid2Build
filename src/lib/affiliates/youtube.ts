/**
 * YouTube Data API v3 (read-only, public channel data, API key only). Off until YOUTUBE_API_KEY is set in Netlify.
 * Quota: channels.list costs 1 unit; the free daily quota is 10,000 units. No OAuth: ownership is proven by the
 * affiliate placing their one-time code (B2B-XXXXXX) in the channel description, checked on the next import.
 */

export interface ChannelData {
  channel_id: string; title: string; description: string; handle: string | null; thumbnail_url: string | null; country: string | null;
  subscriber_count: string | null; subscribers_hidden: boolean; view_count: string | null; video_count: string | null;
}

/** What the person typed: a channel URL, @handle, or UC… id → the lookup to make. */
export function parseChannelInput(raw: string): { id: string } | { handle: string } | null {
  const s = raw.trim();
  if (!s) return null;
  const id = /(?:^|\/channel\/)(UC[A-Za-z0-9_-]{22})(?:[/?#]|$)/.exec(s);
  if (id) return { id: id[1] };
  const h = /(?:^|youtube\.com\/)@([A-Za-z0-9._-]{3,100})(?:[/?#]|$)/.exec(s);
  if (h) return { handle: h[1] };
  if (/^[A-Za-z0-9._-]{3,100}$/.test(s)) return { handle: s.replace(/^@/, "") };
  return null;
}

export function youtubeConfigured(): boolean {
  return !!process.env.YOUTUBE_API_KEY;
}

type ApiChannel = {
  id: string;
  snippet?: { title?: string; description?: string; customUrl?: string; country?: string; thumbnails?: Record<string, { url?: string }> };
  statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean; viewCount?: string; videoCount?: string };
};

export function mapChannel(c: ApiChannel): ChannelData {
  const t = c.snippet?.thumbnails ?? {};
  return {
    channel_id: c.id, title: c.snippet?.title ?? "", description: c.snippet?.description ?? "",
    handle: c.snippet?.customUrl ?? null, thumbnail_url: t.medium?.url ?? t.default?.url ?? null, country: c.snippet?.country ?? null,
    subscriber_count: c.statistics?.hiddenSubscriberCount ? null : c.statistics?.subscriberCount ?? null, subscribers_hidden: !!c.statistics?.hiddenSubscriberCount,
    view_count: c.statistics?.viewCount ?? null, video_count: c.statistics?.videoCount ?? null,
  };
}

/** Fetches one channel's public snippet + statistics. Throws Error("youtube_off" | "not_found" | "youtube_error"). */
export async function fetchChannel(input: { id: string } | { handle: string }, f: typeof fetch = fetch): Promise<ChannelData> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error("youtube_off");
  const u = new URL("https://www.googleapis.com/youtube/v3/channels");
  u.searchParams.set("part", "snippet,statistics");
  if ("id" in input) u.searchParams.set("id", input.id); else u.searchParams.set("forHandle", `@${input.handle}`);
  u.searchParams.set("key", key);
  const r = await f(u, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error("youtube_error");
  const body = (await r.json()) as { items?: ApiChannel[] };
  const c = body.items?.[0];
  if (!c) throw new Error("not_found");
  return mapChannel(c);
}
