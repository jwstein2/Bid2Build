/**
 * The owner's ready-made UTM-tagged links for marketing that runs outside this app (outreach email,
 * Facebook posts, group chats, YouTube). docs/marketing/UTM_LINKS.md is the copy-paste version; the
 * unit test checks every link here lands in the intended owner-report channel.
 */
import type { Channel } from "../admin/channels";

export interface UtmPreset { channel: Channel; label: string; source: string; medium: string; campaign: string }

export const UTM_PRESETS = {
  email: { channel: "email_outreach", label: "Automated outreach email", source: "instantly", medium: "email", campaign: "cold_outreach" },
  facebook: { channel: "social", label: "Facebook posts (page, profile or groups)", source: "facebook", medium: "social", campaign: "daily_posts" },
  groupchat: { channel: "social", label: "Group chats (text, WhatsApp, Messenger)", source: "groupchat", medium: "social", campaign: "group_chats" },
  youtube: { channel: "youtube", label: "YouTube videos (description, pinned comment)", source: "youtube", medium: "video", campaign: "videos" },
} as const satisfies Record<string, UtmPreset>;

export function utmLink(origin: string, path: string, p: Pick<UtmPreset, "source" | "medium" | "campaign">, content?: string): string {
  const u = new URL(path, origin);
  u.searchParams.set("utm_source", p.source);
  u.searchParams.set("utm_medium", p.medium);
  u.searchParams.set("utm_campaign", p.campaign);
  if (content) u.searchParams.set("utm_content", content);
  return u.toString();
}
