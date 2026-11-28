// Shared by the growth-worker and growth-oauth Edge Functions.
// Connect as growth_worker only. Keep the ".<project-ref>" user suffix the pooler needs, if the platform URL has one.
export function workerDbUrl(env: (k: string) => string | undefined): string {
  const explicit = env("GROWTH_DB_URL");
  if (explicit) return explicit;
  const base = env("SUPABASE_DB_URL"), password = env("GROWTH_DB_PASSWORD");
  if (!base || !password) throw new Error("set GROWTH_DB_PASSWORD (or GROWTH_DB_URL) for the growth_worker role");
  const u = new URL(base);
  const dot = decodeURIComponent(u.username).indexOf(".");
  u.username = "growth_worker" + (dot >= 0 ? decodeURIComponent(u.username).slice(dot) : "");
  u.password = encodeURIComponent(password);
  return u.toString();
}
