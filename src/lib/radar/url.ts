import { createHash } from "node:crypto";
import { sourceForHost, type SourceDef } from "./sources";

/**
 * Discussion URL handling for manual import. Nothing here fetches the URL: Built2Bid only stores a
 * canonical reference so the owner can open the discussion and duplicates are caught.
 */

const TRACKING = /^(utm_|fbclid$|gclid$|igshid$|si$|share_id$|ref$|ref_src$|ref_source$|context$|sort$|rdt$|_branch_|mc_)/i;

export interface ParsedDiscussion {
  canonicalUrl: string;
  urlHash: string;
  source: SourceDef;
  /** Platform-specific discussion id when one can be read from the URL (e.g. Reddit post id). */
  threadId: string | null;
}

export class DiscussionUrlError extends Error {}

export function parseDiscussionUrl(raw: string): ParsedDiscussion {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { throw new DiscussionUrlError("That doesn't look like a link. Paste the full https:// address of the discussion."); }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new DiscussionUrlError("Only http(s) discussion links can be imported.");
  if (u.username || u.password) throw new DiscussionUrlError("Links with embedded credentials are not accepted.");
  const host = u.hostname.toLowerCase().replace(/^(www|m|old|np|new)\./, "");
  if (!host.includes(".")) throw new DiscussionUrlError("That link has no public domain.");
  const source = sourceForHost(host);

  let path = u.pathname.replace(/\/{2,}/g, "/");
  let threadId: string | null = null;
  const params = new URLSearchParams();

  if (source.key === "reddit") {
    // /r/<sub>/comments/<id>/<slug>/ -> keep only /r/<sub>/comments/<id>/ ; redd.it/<id> -> id only.
    const m = path.match(/^\/r\/([^/]+)\/comments\/([a-z0-9]+)/i);
    if (m) { threadId = `t3_${m[2].toLowerCase()}`; path = `/r/${m[1].toLowerCase()}/comments/${m[2].toLowerCase()}/`; }
    else if (host === "redd.it") { const id = path.split("/")[1]?.toLowerCase(); if (id) { threadId = `t3_${id}`; path = `/comments/${id}/`; } }
    return finish("reddit.com", path, params, source, threadId);
  }
  if (source.key === "youtube") {
    const id = host === "youtu.be" ? path.split("/")[1] : u.searchParams.get("v") ?? path.match(/^\/(?:shorts|live)\/([\w-]{6,})/)?.[1] ?? null;
    if (id) {
      params.set("v", id);
      const lc = u.searchParams.get("lc");
      if (lc) params.set("lc", lc);
      threadId = lc ? `yt:${id}:${lc}` : `yt:${id}`;
      return finish("youtube.com", "/watch", params, source, threadId);
    }
    return finish("youtube.com", path, params, source, null);
  }

  // Generic: keep non-tracking query params in sorted order (some forums use ?t=123 for threads).
  const keep = [...u.searchParams.entries()].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => a.localeCompare(b));
  for (const [k, v] of keep) params.append(k, v);
  if (source.key === "facebook") {
    const g = path.match(/^\/groups\/([^/]+)\/(?:posts|permalink)\/(\d+)/);
    if (g) threadId = `fb:${g[1]}:${g[2]}`;
  }
  const xf = path.match(/\/threads\/(?:[^/]*\.)?(\d+)\/?/); // XenForo-style forums (Contractor Talk, PaintTalk, LawnSite)
  if (xf) { threadId = `${source.key}:${xf[1]}`; path = path.replace(/\/page-\d+\/?$/, "/"); }
  return finish(host, path, params, source, threadId);
}

function finish(host: string, path: string, params: URLSearchParams, source: SourceDef, threadId: string | null): ParsedDiscussion {
  const p = path.length > 1 ? path.replace(/\/+$/, "") : "";
  const q = params.toString();
  const canonicalUrl = `https://${host}${p}${q ? `?${q}` : ""}`;
  return { canonicalUrl, urlHash: hashUrl(canonicalUrl), source, threadId };
}

export const hashUrl = (canonical: string) => createHash("sha256").update(canonical.toLowerCase()).digest("hex");
