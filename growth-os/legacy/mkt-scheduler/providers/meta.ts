// Direct Meta Graph API adapter for a Facebook Page (fallback, and for AI-labelled reels).
// Reels: developers.facebook.com/documentation/video-api/guides/reels-publishing (start -> upload by file_url -> finish,
// video_state SCHEDULED + scheduled_publish_time 10 min..29 days ahead, is_ai_generated, 30 API reels / Page / 24 h).
// Posts/photos: /{page}/feed and /{page}/photos with published=false + scheduled_publish_time.
import { type Capabilities, type FetchLike, type Provider, type StatusResult, type SubmitInput, type SubmitResult, TimeoutError, fetchWithTimeout, sameCaption } from "./types.ts";

export function metaProvider(pageToken: string, graphVersion = "v25.0", f: FetchLike = fetch, timeoutMs = 30000): Provider {
  const G = `https://graph.facebook.com/${graphVersion}`;

  async function call(method: "GET" | "POST" | "DELETE", path: string, params: Record<string, string> = {}, base = G) {
    const body = new URLSearchParams({ ...params, access_token: pageToken });
    const url = method === "GET" ? `${base}/${path}?${body}` : `${base}/${path}`;
    const res = await fetchWithTimeout(f, url, method === "GET" ? { method } : { method, body }, timeoutMs);
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  }

  // Meta error -> our outcome. Codes: 190 token, 10/200 permission, 4/17/32/613 rate limit, 1/2 transient.
  function mapError(json: any): SubmitResult {
    const e = json?.error ?? {};
    const code = String(e.code ?? "UNKNOWN");
    const detail = String(e.message ?? "Meta error").slice(0, 500);
    if (["1", "2", "4", "17", "32", "613"].includes(code) || e.is_transient) return { outcome: "error", code: `META_${code}`, detail };
    return { outcome: "rejected", code: `META_${code}`, detail };
  }

  const capabilities: Capabilities = {
    kinds: ["post", "reel"],
    media: { image: true, video: true },
    video: { minSeconds: 3, maxSeconds: 90, aspect: "9:16, 1080x1920 recommended, H.264, AAC 48 kHz" },
    scheduling: { minLeadMinutes: 10, maxLeadDays: 29 },
    auth: "Page access token from a system user in the Built2Bid business portfolio (pages_show_list, pages_read_engagement, pages_manage_posts).",
    aiLabel: "supported",
    notes: ["30 API-published reels per Page per rolling 24 h.", "No idempotency key: lost responses are resolved by looking up scheduled posts."],
  };

  // Meta needs >= 10 min lead for scheduling; closer than that we publish immediately.
  const schedParams = (i: SubmitInput): Record<string, string> => {
    const lead = (i.publishAt.getTime() - Date.now()) / 60000;
    return i.publishNow || lead < 11 ? { published: "true" } : { published: "false", scheduled_publish_time: String(Math.floor(i.publishAt.getTime() / 1000)) };
  };

  return {
    name: "meta",
    capabilities,

    async submit(i: SubmitInput): Promise<SubmitResult> {
      try {
        if (i.kind === "reel") {
          if (!i.media || i.media.type !== "video") return { outcome: "rejected", code: "NO_VIDEO", detail: "reel needs a video" };
          const start = await call("POST", `${i.channelId}/video_reels`, { upload_phase: "start" });
          if (start.status >= 400 || !start.json.video_id) return mapError(start.json);
          const videoId = String(start.json.video_id);
          const up = await fetchWithTimeout(f, `https://rupload.facebook.com/video-upload/${graphVersion}/${videoId}`, {
            method: "POST", headers: { Authorization: `OAuth ${pageToken}`, file_url: i.media.url },
          }, timeoutMs);
          if (up.status >= 400) return mapError(await up.json().catch(() => ({})));
          const sched = schedParams(i);
          const finish = await call("POST", `${i.channelId}/video_reels`, {
            video_id: videoId, upload_phase: "finish", description: i.linkUrl ? `${i.caption}\n\n${i.linkUrl}` : i.caption,
            video_state: sched.published === "true" ? "PUBLISHED" : "SCHEDULED",
            ...(sched.scheduled_publish_time ? { scheduled_publish_time: sched.scheduled_publish_time } : {}),
            ...(i.media.aiGenerated ? { is_ai_generated: "true" } : {}),
          });
          if (finish.status >= 400 || finish.json.success === false) return mapError(finish.json);
          return { outcome: "accepted", providerPostId: videoId };
        }
        if (i.kind === "story") return { outcome: "rejected", code: "UNSUPPORTED", detail: "stories go through Buffer" };
        const sched = schedParams(i);
        const r = i.media?.type === "image"
          ? await call("POST", `${i.channelId}/photos`, { url: i.media.url, caption: i.linkUrl ? `${i.caption}\n\n${i.linkUrl}` : i.caption, ...sched })
          : await call("POST", `${i.channelId}/feed`, { message: i.caption, ...(i.linkUrl ? { link: i.linkUrl } : {}), ...sched });
        if (r.status >= 400 || !(r.json.post_id || r.json.id)) return mapError(r.json);
        return { outcome: "accepted", providerPostId: String(r.json.post_id ?? r.json.id) };
      } catch (e) {
        return { outcome: "timeout", code: e instanceof TimeoutError ? "TIMEOUT" : "NETWORK", detail: (e as Error).message };
      }
    },

    async findExisting({ channelId, caption, publishAt }) {
      for (const edge of ["scheduled_posts", "published_posts"]) {
        const r = await call("GET", `${channelId}/${edge}`, { fields: "id,message,scheduled_publish_time,created_time", limit: "50" });
        if (r.status >= 400) throw new Error(`Meta lookup failed: ${r.json?.error?.message ?? r.status}`);
        const hit = (r.json.data ?? []).find((p: any) => p.message && sameCaption(p.message, caption) &&
          Math.abs(((p.scheduled_publish_time ?? Date.parse(p.created_time) / 1000) * 1000) - publishAt.getTime()) < 6 * 36e5);
        if (hit) return String(hit.id);
      }
      return null;
    },

    async status({ channelId, providerPostId, caption, publishAt }): Promise<StatusResult> {
      const id = providerPostId ?? await this.findExisting({ channelId, caption, publishAt });
      if (!id) return { state: "not_found" };
      const r = await call("GET", id, { fields: "id,is_published,permalink_url,created_time,status" });
      if (r.status === 404 || r.json?.error?.code === 100) return { state: "not_found" };
      if (r.status >= 400) throw new Error(`Meta status failed: ${r.json?.error?.message ?? r.status}`);
      const j = r.json;
      const pub = j.status?.publishing_phase?.publish_status;   // reels
      if (pub === "error" || j.status?.video_status === "error") return { state: "error", detail: "Meta reports a processing/publishing error" };
      if (j.is_published === true || pub === "published")
        return { state: "published", url: j.permalink_url ? (j.permalink_url.startsWith("http") ? j.permalink_url : `https://www.facebook.com${j.permalink_url}`) : undefined,
                 publishedAt: j.created_time ? new Date(j.created_time) : undefined, providerPostId: String(j.id) };
      return { state: "scheduled", providerPostId: String(j.id) };
    },

    async remove(providerPostId) { await call("DELETE", providerPostId); },

    async health(channelId) {
      const r = await call("GET", channelId, { fields: "id,name" });
      if (r.status >= 400) return { ok: false, detail: `Meta: ${r.json?.error?.message ?? r.status} (token expired or permission removed?)` };
      return { ok: true, detail: `Page: ${r.json.name}` };
    },
  };
}
