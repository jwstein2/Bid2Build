import "server-only";

/**
 * Supabase database backup check (Management API, GET only).
 *
 * Pro projects get one automatic backup a day, kept 7 days. This reads the backup list and reports how
 * old the newest completed one is, so the owner hears about it if backups stop. It needs
 * SUPABASE_MANAGEMENT_TOKEN with permission to read the project's backups; without it the check is
 * "not_connected" and makes no request.
 */
export const BACKUP_STALE_HOURS = 36;

export interface BackupSummary {
  latestAt: string | null;
  ageHours: number | null;
  completed: number;
  failedLast7Days: number;
  pitr: boolean;
  stale: boolean;
}

export type BackupCheck =
  | { state: "not_connected"; env: string }
  | { state: "error"; env: string; message: string; code: "token_forbidden" | "provider_error" | "config" }
  | { state: "ok" | "stale"; env: string; data: BackupSummary; fetchedAt: string };

export const BACKUP_TOKEN_ENV = "SUPABASE_MANAGEMENT_TOKEN";

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Supabase timestamps sometimes omit the zone; they are UTC. */
function parseUtc(v: unknown): number | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const s = /[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : `${v}Z`;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

/** Pure: summarize GET /v1/projects/{ref}/database/backups. */
export function summarizeBackups(body: unknown, nowMs: number, staleHours = BACKUP_STALE_HOURS): BackupSummary {
  const o = obj(body);
  const list = Array.isArray(o.backups) ? o.backups.map(obj) : [];
  const done = list.filter((b) => String(b.status ?? "").toUpperCase() === "COMPLETED").map((b) => parseUtc(b.inserted_at)).filter((t): t is number => t != null);
  const phys = obj(o.physical_backup_data).latest_physical_backup_date_unix;
  const physMs = typeof phys === "number" && Number.isFinite(phys) && phys > 0 ? phys * 1000 : null;
  const candidates = physMs != null ? [...done, physMs] : done;
  const latest = candidates.length ? Math.max(...candidates) : null;
  const weekAgo = nowMs - 7 * 86_400_000;
  const failedLast7Days = list.filter((b) => String(b.status ?? "").toUpperCase() === "FAILED" && (parseUtc(b.inserted_at) ?? 0) >= weekAgo).length;
  const ageHours = latest == null ? null : Math.max(0, Math.round(((nowMs - latest) / 3_600_000) * 10) / 10);
  return {
    latestAt: latest == null ? null : new Date(latest).toISOString(),
    ageHours,
    completed: done.length,
    failedLast7Days,
    pitr: o.pitr_enabled === true,
    stale: ageHours == null || ageHours > staleHours,
  };
}

export async function checkBackups(now = new Date()): Promise<BackupCheck> {
  const token = process.env[BACKUP_TOKEN_ENV]?.trim();
  if (!token) return { state: "not_connected", env: BACKUP_TOKEN_ENV };
  const ref = /^https:\/\/([a-z0-9]{20})\.supabase\.co/.exec(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")?.[1];
  if (!ref) return { state: "error", env: BACKUP_TOKEN_ENV, code: "config", message: "Project ref not found in NEXT_PUBLIC_SUPABASE_URL" };
  try {
    const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/backups`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const forbidden = res.status === 401 || res.status === 403;
      return { state: "error", env: BACKUP_TOKEN_ENV, code: forbidden ? "token_forbidden" : "provider_error", message: forbidden ? `Token can't read backups (HTTP ${res.status}): give it backup read access` : `Supabase returned HTTP ${res.status}` };
    }
    const data = summarizeBackups(await res.json(), now.getTime());
    return { state: data.stale ? "stale" : "ok", env: BACKUP_TOKEN_ENV, data, fetchedAt: now.toISOString() };
  } catch {
    return { state: "error", env: BACKUP_TOKEN_ENV, code: "provider_error", message: "Supabase did not respond" };
  }
}
