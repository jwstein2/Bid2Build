export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60); if (m < 60) return `${m}m`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h`;
  const d = Math.round(h / 24); if (d < 30) return `${d}d`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export const initials = (name: string | null | undefined) =>
  (name ?? "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

/** Deterministic avatar tint from a user id (no image uploads needed for avatars). */
export function avatarTone(id: string): string {
  const tones = ["bg-navy text-cyan", "bg-cyan text-navy", "bg-teal text-white", "bg-[#6a4ba8] text-white", "bg-[#b45309] text-white", "bg-[#33465a] text-white"];
  let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return tones[h % tones.length];
}

export const ROLE_LABEL: Record<string, string> = { admin: "Admin", moderator: "Moderator", instructor: "Instructor", member: "Member" };
