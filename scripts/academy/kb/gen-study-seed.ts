/**
 * Validates the Academy study bank (src/lib/academy/kb/seed/study.ts) and generates
 *   supabase/migrations/20270222004000_academy_kb_study_seed.sql
 *   docs/academy/rollback_20270222004000.sql
 * Run: npx tsx scripts/academy/kb/gen-study-seed.ts            (add --check to validate only)
 *
 * Refuses to build when a regulatory item cites a section that is not in the verified snapshot, or when its proof
 * phrase does not appear word for word in that section's official text. Idempotent: deterministic ids + ON CONFLICT
 * DO NOTHING, so re-running never overwrites what an Academy editor changed.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CATEGORIES, DECKS, EXAMS, ITEMS, type StudyItem } from "../../../src/lib/academy/kb/seed/study";
import { trades } from "../../../src/lib/trades/catalog";

const ROOT = path.resolve(import.meta.dirname, "../../..");
type Snap = {
  ecfr: { title: number; section: string; rows: { paragraph: string | null; text: string }[] }[];
  mn: { part: string; subparts: { text: string }[] }[];
};
const snap = JSON.parse(readFileSync(path.join(ROOT, "src/lib/academy/kb/seed/official-snapshot.json"), "utf8")) as Snap;

/** Section key (without the "section:" prefix) -> { citation, text }, built exactly like gen-seed.ts builds sections. */
export function sectionIndex(s: Snap = snap) {
  const m = new Map<string, { citation: string; text: string }>();
  for (const e of s.ecfr) for (const r of e.rows) {
    const number = r.paragraph ? `${e.section}(${r.paragraph})` : e.section;
    m.set(`cfr:${number}`, { citation: `${e.title} CFR ${number}`, text: r.text });
  }
  for (const p of s.mn) for (const sp of p.subparts) {
    if (/^Subp(?:art|\.)\s*\d+[a-z]?\.\s*\[Repealed/.test(sp.text) || sp.text.length < 60) continue;
    const n = /^Subp(?:art|\.)\s*(\d+[a-z]?)\./.exec(sp.text)?.[1] ?? null;
    const number = n ? `${p.part} subp. ${n}` : p.part;
    m.set(`mn:${number}`, { citation: n ? `Minn. R. ${p.part}, subp. ${n}` : `Minn. R. ${p.part}`, text: sp.text });
  }
  return m;
}

const norm = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
const h32 = (s: string) => parseInt(createHash("md5").update(s).digest("hex").slice(0, 8), 16);

/** Deterministic option order (so the answer isn't always in the same slot) and the index of the right answer. */
export function arrange(it: StudyItem): { options: string[]; correct: number } | null {
  if (!it.o) return null;
  const opts = [...it.o];
  let seed = h32(`order:${it.k}`);
  for (let i = opts.length - 1; i > 0; i--) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    const j = seed % (i + 1);
    [opts[i], opts[j]] = [opts[j], opts[i]];
  }
  return { options: opts, correct: opts.indexOf(it.a) };
}

export function validate() {
  const errors: string[] = [];
  const idx = sectionIndex();
  const deckBySlug = new Map(DECKS.map((d) => [d.slug, d]));
  const tradeSlugs = new Set(trades.map((t) => t.slug));
  const keys = new Set<string>();
  const prompts = new Set<string>();
  for (const d of DECKS) {
    if (!/^[a-z0-9-]{2,60}$/.test(d.slug)) errors.push(`deck ${d.slug}: bad slug`);
    for (const t of d.trades) if (!tradeSlugs.has(t)) errors.push(`deck ${d.slug}: unknown trade ${t}`);
  }
  for (const c of CATEGORIES) {
    for (const d of c.decks) if (!deckBySlug.has(d)) errors.push(`category ${c.slug}: unknown deck ${d}`);
    for (const t of c.trades ?? []) if (!tradeSlugs.has(t)) errors.push(`category ${c.slug}: unknown trade ${t}`);
  }
  for (const it of ITEMS) {
    const at = `item ${it.k}`;
    if (!/^[a-z0-9-]{3,80}$/.test(it.k)) errors.push(`${at}: bad key`);
    if (keys.has(it.k)) errors.push(`${at}: duplicate key`);
    keys.add(it.k);
    const kind = it.o ? "question" : "flashcard";
    const pk = `${kind}:${it.q.toLowerCase()}`;
    if (prompts.has(pk)) errors.push(`${at}: duplicate prompt`);
    prompts.add(pk);
    if (!deckBySlug.has(it.d)) errors.push(`${at}: unknown deck ${it.d}`);
    if (it.q.length < 5 || it.q.length > 1000) errors.push(`${at}: prompt length`);
    if (!it.a || it.a.length > 2000) errors.push(`${at}: answer length`);
    if ((it.x ?? "").length > 2000) errors.push(`${at}: explanation too long`);
    for (const t of it.t ?? []) if (!tradeSlugs.has(t)) errors.push(`${at}: unknown trade ${t}`);
    if (it.o) {
      if (it.o.length < 2 || it.o.length > 6) errors.push(`${at}: needs 2-6 options`);
      if (it.o.filter((o) => o === it.a).length !== 1) errors.push(`${at}: answer must appear exactly once in options`);
      if (new Set(it.o).size !== it.o.length) errors.push(`${at}: duplicate options`);
    }
    if (it.s) {
      const sec = idx.get(it.s);
      if (!sec) errors.push(`${at}: section ${it.s} is not in the verified snapshot`);
      else if (!it.p) errors.push(`${at}: regulatory item needs a proof phrase`);
      else if (!norm(sec.text).includes(norm(it.p))) errors.push(`${at}: proof phrase not found in ${it.s}: "${it.p}"`);
    } else if (it.p) errors.push(`${at}: proof phrase without a section`);
  }
  for (const e of EXAMS) {
    const pool = ITEMS.filter((i) => i.o && e.decks.includes(i.d)).length;
    if (pool < e.count) errors.push(`exam ${e.slug}: only ${pool} questions for a ${e.count}-question exam`);
    for (const d of e.decks) if (!deckBySlug.has(d)) errors.push(`exam ${e.slug}: unknown deck ${d}`);
    if (e.summary.length > 1000) errors.push(`exam ${e.slug}: summary too long`);
  }
  return errors;
}

const q = (v: unknown): string => (v === null || v === undefined ? "null" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const arr = (xs: string[] | undefined) => (xs && xs.length ? `array[${xs.map(q).join(", ")}]::text[]` : "'{}'::text[]");
const id = (key: string) => `md5(${q(`academykb:${key}`)})::uuid`;

function build() {
  const idx = sectionIndex();
  const deckBySlug = new Map(DECKS.map((d) => [d.slug, d]));
  const rows = ITEMS.map((it, i) => {
    const deck = deckBySlug.get(it.d)!;
    const ar = arrange(it);
    const sec = it.s ? idx.get(it.s)! : null;
    const tags = EXAMS.filter((e) => e.decks.includes(it.d)).map((e) => e.slug);
    return `  (${[id(`item:${it.k}`), q(it.k), q(ar ? "question" : "flashcard"), q(it.d), arr(it.t ?? deck.trades), q(deck.state ?? null), q(it.l ?? "medium"), q(it.q), q(it.a),
      ar ? arr(ar.options) : "null", ar ? String(ar.correct) : "null", q(it.x ?? null), sec ? id(`section:${it.s}`) : "null", q(sec?.citation ?? null),
      q(sec ? "regulatory" : "concept"), "'original'", "'approved'", arr(tags), i].join(", ")})`;
  });
  const out: string[] = [`-- Generated by scripts/academy/kb/gen-study-seed.ts from src/lib/academy/kb/seed/study.ts. Do not edit by hand.
-- Original study material (no copied exam questions). Every regulatory item cites a verified section and its proof
-- phrase was checked word for word against the official text when this file was generated.
-- Safe to re-run: deterministic ids + ON CONFLICT DO NOTHING. Requires 20270220001000 and 20270220002000.
`];
  const cols = "id, key, kind, deck, trades, state_code, difficulty, prompt, answer, options, correct, explanation, section_id, citation, basis, origin, status, exam_tags, sort_order";
  for (let i = 0; i < rows.length; i += 60) {
    out.push(`insert into public.academy_kb_items (${cols}) values\n${rows.slice(i, i + 60).join(",\n")}\non conflict do nothing;\n`);
  }
  out.push("insert into public.academy_kb_exams (slug, title, summary, state_code, license_kind, trades, decks, default_count, minutes, book_policy, official_info_url, status, sort_order) values");
  out.push(EXAMS.map((e, i) => `  (${[q(e.slug), q(e.title), q(e.summary), q(e.state ?? null), q(e.kind), arr(e.trades), arr(e.decks), e.count, e.minutes, "'unverified'", q(e.official ?? null), "'published'", i].join(", ")})`).join(",\n") + "\non conflict (slug) do nothing;\n");
  return out.join("\n");
}

function rollback() {
  return `-- Rollback for 20270222004000_academy_kb_study_seed.sql: removes only the seeded study items and practice exams.
-- Learner progress on these items is removed with them (cascade); attempts keep their history with exam_slug cleared.
delete from public.academy_kb_items where key in (${ITEMS.map((i) => q(i.k)).join(", ")}) and origin = 'original';
delete from public.academy_kb_exams where slug in (${EXAMS.map((e) => q(e.slug)).join(", ")});
`;
}

if (process.argv[1] && import.meta.filename === path.resolve(process.argv[1])) {
  const errors = validate();
  if (errors.length) {
    console.error(errors.join("\n"));
    console.error(`\n${errors.length} problem(s). Nothing written.`);
    process.exit(1);
  }
  const qn = ITEMS.filter((i) => i.o).length;
  console.log(`OK: ${ITEMS.length} items (${qn} questions, ${ITEMS.length - qn} flashcards, ${ITEMS.filter((i) => i.s).length} regulatory), ${EXAMS.length} exams.`);
  if (!process.argv.includes("--check")) {
    writeFileSync(path.join(ROOT, "supabase/migrations/20270222004000_academy_kb_study_seed.sql"), build());
    writeFileSync(path.join(ROOT, "docs/academy/rollback_20270222004000.sql"), rollback());
    console.log("Wrote migration and rollback.");
  }
}
