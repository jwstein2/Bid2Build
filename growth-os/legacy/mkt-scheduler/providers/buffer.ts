// Buffer GraphQL adapter (https://api.buffer.com, personal API key as Bearer token).
// Shapes from developers.buffer.com (Nov 2026): createPost / posts / post / deletePost,
// ShareMode addToQueue|customScheduled|shareNext|shareNow, PostStatus draft|error|needs_approval|scheduled|sending|sent,
// PostTypeFacebook post|reel|story, assets = [{image:{url}} | {video:{url}}].
import { type Capabilities, type FetchLike, type Provider, type StatusResult, type SubmitInput, type SubmitResult, TimeoutError, fetchWithTimeout, sameCaption } from "./types.ts";

const ENDPOINT = "https://api.buffer.com";

export function bufferProvider(apiKey: string, organizationId: string, f: FetchLike = fetch, timeoutMs = 20000): Provider {
  async function gql(query: string, variables: Record<string, unknown>) {
    const res = await fetchWithTimeout(f, ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query, variables }),
    }, timeoutMs);
    if (res.status === 429) return { rateLimited: true as const };
    if (res.status >= 500) return { serverError: `HTTP ${res.status}` };
    const body = await res.json();
    return { body };
  }

  const capabilities: Capabilities = {
    kinds: ["post", "reel", "story"],
    media: { image: true, video: true },
    video: { minSeconds: 3, maxSeconds: 90, aspect: "9:16 (reels)" },
    scheduling: { minLeadMinutes: 0, maxLeadDays: 365 },
    auth: "Buffer personal API key (Bearer). Page connected inside Buffer with Meta login by the owner.",
    aiLabel: "unknown",
    notes: [
      "Media must be a public URL that stays reachable until the post is sent.",
      "Facebook Groups are notification-only in Buffer: never use this adapter for Groups.",
      "Instagram music/stickers/link stickers fall back to phone notifications: not automatic.",
    ],
  };

  function classify(code: string | undefined): "rejected" | "error" {
    // permanent problems: bad input or auth; transient: everything else
    return ["UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "BAD_USER_INPUT", "VALIDATION"].includes(code ?? "") ? "rejected" : "error";
  }

  return {
    name: "buffer",
    capabilities,

    async submit(i: SubmitInput): Promise<SubmitResult> {
      const input: Record<string, unknown> = {
        text: i.linkUrl && !i.caption.includes(i.linkUrl) ? `${i.caption}\n\n${i.linkUrl}` : i.caption,
        channelId: i.channelId,
        schedulingType: "automatic",
        mode: i.publishNow ? "shareNow" : "customScheduled",
        metadata: { facebook: { type: i.kind } },
      };
      if (!i.publishNow) input.dueAt = i.publishAt.toISOString();
      if (i.media) input.assets = [i.media.type === "video" ? { video: { url: i.media.url } } : { image: { url: i.media.url } }];
      const q = `mutation Create($input: CreatePostInput!) { createPost(input: $input) {
        ... on PostActionSuccess { post { id status dueAt } }
        ... on MutationError { message } } }`;
      try {
        const r = await gql(q, { input });
        if ("rateLimited" in r) return { outcome: "error", code: "RATE_LIMIT_EXCEEDED", detail: "Buffer rate limit" };
        if ("serverError" in r) return { outcome: "error", code: "SERVER", detail: r.serverError! };
        const b = r.body;
        if (b.errors?.length) {
          const code = b.errors[0]?.extensions?.code;
          return { outcome: code === "RATE_LIMIT_EXCEEDED" || code === "UNEXPECTED" ? "error" : classify(code), code: code ?? "GRAPHQL", detail: b.errors[0]?.message ?? "error" };
        }
        const cp = b.data?.createPost;
        if (cp?.post?.id) return { outcome: "accepted", providerPostId: cp.post.id };
        return { outcome: "rejected", code: "MUTATION_ERROR", detail: cp?.message ?? "no post returned" };
      } catch (e) {
        if (e instanceof TimeoutError) return { outcome: "timeout", code: "TIMEOUT", detail: e.message };
        return { outcome: "timeout", code: "NETWORK", detail: (e as Error).message }; // response lost: verify before resend
      }
    },

    async findExisting({ channelId, caption, publishAt }) {
      const q = `query Find($input: PostsInput!) { posts(input: $input, first: 50) { edges { node { id text dueAt status } } } }`;
      const hour = 36e5;
      const r = await gql(q, { input: { organizationId, filter: {
        channelIds: [channelId],
        startDate: new Date(publishAt.getTime() - 6 * hour).toISOString(),
        endDate: new Date(publishAt.getTime() + 6 * hour).toISOString(),
      } } });
      if (!("body" in r)) throw new Error("Buffer lookup failed; will retry later");
      const nodes = r.body.data?.posts?.edges?.map((e: { node: { id: string; text: string } }) => e.node) ?? [];
      const hit = nodes.find((n: { text: string }) => sameCaption(n.text, caption) || n.text.startsWith(caption.slice(0, 120)));
      return hit?.id ?? null;
    },

    async status({ providerPostId, channelId, caption, publishAt }): Promise<StatusResult> {
      const id = providerPostId ?? await this.findExisting({ channelId, caption, publishAt });
      if (!id) return { state: "not_found" };
      const q = `query One($input: PostInput!) { post(input: $input) { id status externalLink sentAt error { message } } }`;
      const r = await gql(q, { input: { id } });
      if (!("body" in r)) throw new Error("Buffer status lookup failed; will retry later");
      const p = r.body.data?.post;
      if (!p) return { state: "not_found" };
      switch (p.status) {
        case "sent": return { state: "published", url: p.externalLink ?? undefined, publishedAt: p.sentAt ? new Date(p.sentAt) : undefined, providerPostId: p.id };
        case "error": return { state: "error", detail: p.error?.message ?? "Buffer reports an error" };
        case "scheduled": case "sending": return { state: "scheduled", providerPostId: p.id };
        default: return { state: "error", detail: `unexpected Buffer status ${p.status} (draft/needs_approval means it will not auto-publish)` };
      }
    },

    async remove(providerPostId) {
      await gql(`mutation Del($input: DeletePostInput!) { deletePost(input: $input) { __typename } }`, { input: { id: providerPostId } });
    },

    async health(channelId) {
      const r = await gql(`query Ch($input: ChannelInput!) { channel(input: $input) { id name service isDisconnected isLocked } }`, { input: { id: channelId } });
      if (!("body" in r)) return { ok: false, detail: "Buffer unreachable" };
      const c = r.body.data?.channel;
      if (!c) return { ok: false, detail: r.body.errors?.[0]?.message ?? "channel not found in Buffer" };
      if (c.isLocked) return { ok: false, detail: `${c.name} is locked in Buffer (plan limit?)` };
      return c.isDisconnected ? { ok: false, detail: `${c.name} is disconnected in Buffer: reconnect it there` } : { ok: true, detail: `${c.service}: ${c.name}` };
    },
  };
}
