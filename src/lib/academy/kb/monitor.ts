/**
 * Monthly official-source monitoring (pure parts). For each source we compute a stable fingerprint of the official
 * publication so that a change is flagged for human review. Nothing here edits content or decides what changed:
 * a changed fingerprint opens a review-queue item, and an Academy admin classifies it.
 *
 *  - eCFR (ecfr.gov/current/title-N/section-X): the eCFR versioner's list of substantive amendment dates for that
 *    section. The page itself changes daily ("up to date as of"), so it is never hashed.
 *  - Minnesota Revisor (revisor.mn.gov/rules/...): the rule text block, without page chrome.
 *  - Anything else: reachability only (no hash), so a page redesign never floods the queue.
 */

export type MonitorPlan =
  | { kind: "ecfr"; fetchUrl: string; section: string }
  | { kind: "revisor"; fetchUrl: string }
  | { kind: "reachability"; fetchUrl: string };

export function planFor(url: string): MonitorPlan | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== "https:") return null;
  if (u.hostname === "www.ecfr.gov") {
    const m = /^\/current\/title-(\d{1,2})\/section-(\d{1,4}\.\d{1,4}[a-z]?)$/.exec(u.pathname.replace(/\/$/, ""));
    if (m) return { kind: "ecfr", section: m[2], fetchUrl: `https://www.ecfr.gov/api/versioner/v1/versions/title-${m[1]}.json?section=${m[2]}` };
  }
  if (u.hostname === "www.revisor.mn.gov" && u.pathname.startsWith("/rules/")) return { kind: "revisor", fetchUrl: u.toString() };
  return { kind: "reachability", fetchUrl: u.toString() };
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/** The text that the fingerprint covers, or null when the response is not what we expected (treated as unreachable). */
export function fingerprintText(plan: MonitorPlan, body: string): string | null {
  if (plan.kind === "ecfr") {
    try {
      const v = JSON.parse(body) as { content_versions?: { identifier?: string; amendment_date?: string; substantive?: boolean; removed?: boolean }[] };
      if (!Array.isArray(v.content_versions)) return null;
      const rows = v.content_versions.filter((x) => x.identifier === plan.section && x.substantive !== false)
        .map((x) => `${x.amendment_date ?? "?"}${x.removed ? ":removed" : ""}`);
      return rows.length ? [...new Set(rows)].sort().join(",") : null;
    } catch { return null; }
  }
  if (plan.kind === "revisor") {
    const m = /<div[^>]*id="rule"[^>]*>([\s\S]*?)<div[^>]*id="(?:footer|history)/.exec(body) ?? /<div[^>]*id="rule"[^>]*>([\s\S]*)/.exec(body);
    if (!m) return null;
    const text = norm(m[1].replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/&sect;|&#167;/g, "§"))
      // The "Published Electronically" stamp changes without any change to the rule.
      .replace(/Published Electronically:\s*[A-Za-z]+ \d{1,2}, \d{4}/g, "");
    return text.length > 40 ? text : null;
  }
  return null;
}

export type CheckOutcome = { result: "unchanged" | "changed" | "unreachable" | "baseline" | "reachable"; hash: string | null; method: "hash_check" | "url_check" };

/** Compares a fresh fingerprint with the stored one. The first fingerprint is a baseline, never a verification. */
export function compare(plan: MonitorPlan, status: number, hash: string | null, previous: string | null): CheckOutcome {
  if (status < 200 || status >= 400) return { result: "unreachable", hash: null, method: plan.kind === "reachability" ? "url_check" : "hash_check" };
  // A reachable page proves nothing about its content, so it is never recorded as a verification.
  if (plan.kind === "reachability") return { result: "reachable", hash: null, method: "url_check" };
  if (!hash) return { result: "unreachable", hash: null, method: "hash_check" };
  if (!previous) return { result: "baseline", hash, method: "hash_check" };
  return { result: previous === hash ? "unchanged" : "changed", hash, method: "hash_check" };
}
