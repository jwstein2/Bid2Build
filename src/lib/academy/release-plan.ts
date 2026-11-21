/**
 * Pure helpers for the Academy weekly release schedule (no server imports, so tests and pages can share them).
 */

/** Today's date in Central time (the business runs on Central), as YYYY-MM-DD. */
export function centralToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "Mon, Nov 30, 2026" style label for a YYYY-MM-DD date (no time zone shift). */
export function releaseLabel(ymd: string, opts: { weekday?: boolean; year?: boolean } = {}): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC", month: "short", day: "numeric", ...(opts.year === false ? {} : { year: "numeric" }), ...(opts.weekday ? { weekday: "short" } : {}),
  }).format(new Date(`${ymd}T12:00:00Z`));
}

export function slugify(title: string): string {
  return title.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").replace(/_/g, " ").trim().replace(/[\s-]+/g, "-").slice(0, 90).replace(/-+$/g, "") || "lesson";
}

/** A lesson slug for a planned title that doesn't clash with the course's existing slugs. */
export function lessonSlug(title: string, taken: string[]): string {
  let base = slugify(title);
  if (base.length < 3) base = `lesson-${base}`;
  let slug = base, n = 2;
  while (taken.includes(slug)) slug = `${base}-${n++}`;
  return slug;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** The first planned lesson title with no written lesson yet (matched by title or slug), or null when all are written. */
export function nextPlannedLesson(planned: string[], written: { slug: string; title: string }[]): { index: number; title: string } | null {
  const titles = new Set(written.map((w) => norm(w.title)));
  const slugs = new Set(written.map((w) => w.slug));
  for (let i = 0; i < planned.length; i++) {
    const t = planned[i].trim();
    if (!t) continue;
    if (!titles.has(norm(t)) && !slugs.has(slugify(t))) return { index: i, title: t };
  }
  return null;
}
