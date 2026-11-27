// Academy Advanced screenshots (scripts/academy/advanced/shots.mjs): canned states for scripts/ux-audit/mock-supabase.mjs.
// Loaded only when MOCK_ADVANCED=1 (start the mock with `npx tsx` so the TypeScript lesson catalog can be imported).
// Switch with GET /__advanced?state=visitor|free|one|aa|staff. No real data.
import { ADV_SUBJECTS, loadAdvCourses } from "../../../src/lib/academy/advanced/content/index.ts";

// Needs private/academy-advanced/lessons/ (paid lesson text is kept out of the public repo).
const COURSES = Object.fromEntries((await loadAdvCourses()).map((c) => [c.subject, c.course]));
import { DEFAULT_STAGES } from "../../../src/lib/academy/advanced/plans.ts";

export function installAdvanced({ rpcs, tables, iso, USER }) {
  const cid = (i) => `99999999-9999-4999-8999-00000000000${i}`;
  const lid = (i, j) => `99999999-9999-4999-8999-0000000${i}0${String(j).padStart(2, "0")}`;
  const withCourse = ADV_SUBJECTS.filter((s) => COURSES[s.slug]).map((s) => ({ ...s, course: COURSES[s.slug] }));
  const courses = withCourse.map((s, i) => ({
    id: cid(i + 1), slug: s.course.slug, trade_slug: null, pillar: s.course.pillar, title: s.course.title, summary: s.course.summary, description: s.course.description,
    level: "advanced", access: "public", status: "published", content_class: "original", cover_path: null, cover_theme: s.theme, featured: false, sort_order: s.course.sort,
    planned_lessons: s.course.plannedLessons, seo_title: null, seo_description: null, updated_at: iso(1), published_at: iso(3), release_on: null, adv_subject: s.slug,
    academy_lessons: [{ count: s.course.lessons.length }],
  }));
  const lessons = withCourse.flatMap((s, i) => s.course.lessons.map((l, j) => ({
    id: lid(i + 1, j), course_id: cid(i + 1), slug: l.slug, title: l.title, summary: l.summary, body_md: l.body, takeaways: l.takeaways, checklist: l.checklist,
    trade_notes: {}, app_action: l.action ?? null, quiz: l.quiz ?? null, access: l.access, status: "published", estimated_minutes: l.minutes, sort_order: j * 10, module: l.module, updated_at: iso(1),
  })));
  tables.academy_courses = [...(tables.academy_courses ?? []).map((c) => ({ adv_subject: null, ...c })), ...courses];
  tables.academy_lessons = [...(tables.academy_lessons ?? []), ...lessons];
  tables.academy_adv_settings = [{ id: true, enabled: true, enrollment_open: true, current_stage: 1, auto_advance: false, count_basis: "lifetime", reservation_minutes: 35 }];
  tables.academy_adv_price_stages = DEFAULT_STAGES.map((s) => ({ ...s, approved_at: s.stage === 1 ? iso(10) : null }));
  tables.academy_adv_subjects = ADV_SUBJECTS.map((s) => ({ slug: s.slug, title: s.title, summary: s.summary, description: s.description ?? null, outcomes: s.outcomes ?? [], icon: s.icon,
    cover_theme: s.theme, status: s.status, recommended_next: s.next ?? null, recommend_reason: s.reason ?? null, sort_order: s.sort }));
  tables.academy_adv_prices = ["one_subject", "two_subjects", "all_access"].map((plan, k) => ({ id: `abababab-abab-4bab-8bab-00000000000${k}`, mode: "test", plan, stage: 1, billing_interval: "month",
    amount_cents: [999, 1499, 2999][k], stripe_price_id: `price_mock${k}`, active: true, created_at: iso(2) }));
  tables.academy_adv_grants = [];
  tables.academy_adv_issues = [{ id: "cdcdcdcd-cdcd-4dcd-8dcd-000000000001", kind: "unknown_plan", ref: "sub_mock123", user_id: null, details: { price_id: "price_unmapped" }, created_at: iso(1), resolved_at: null }];
  tables.academy_adv_founding = [{ user_id: USER.id, mode: "test", position: 1, stage_at_join: 1, status: "qualifying", disqualified_reason: null, first_paid_at: iso(4) }];

  const NONE = { all_access: false, subjects: [], software: false, plan: null, sources: [], staff: false };
  const ACCESS = {
    visitor: NONE, free: NONE,
    one: { ...NONE, subjects: ["business-management"], plan: "one_subject", sources: ["membership"] },
    aa: { ...NONE, all_access: true, software: true, plan: "all_access", sources: ["membership"] },
    staff: { ...NONE, all_access: true, staff: true, sources: ["staff"] },
  };
  const membership = (plan, subjects, amount) => [{ id: "efefefef-efef-4fef-8fef-000000000001", user_id: USER.id, mode: "test", plan, subjects, stage: 1, amount_cents: amount, status: "active",
    current_period_end: iso(-24), cancel_at_period_end: false, stripe_subscription_id: "sub_mock1", stripe_price_id: "price_mock", created_at: iso(6) }];
  let state = "free";
  const set = (s) => {
    state = ACCESS[s] ? s : "free";
    tables.academy_adv_memberships = state === "one" ? membership("one_subject", ["business-management"], 999) : state === "aa" ? membership("all_access", [], 2999) : [];
  };
  set("free");
  const has = (course) => { const a = ACCESS[state]; const subj = courses.find((c) => c.id === course)?.adv_subject; return a.all_access || a.subjects.includes(subj); };
  rpcs.academy_me = () => state === "visitor" ? null : ({ signed_in: true, member: true, status: "active", role: state === "staff" ? "admin" : "member", display_name: "Alex R.", trades: ["remodeling"], points: 40, level: 2, platform_admin: false });
  rpcs.academy_adv_access = () => ACCESS[state];
  rpcs.academy_adv_my_access = () => ACCESS[state];
  rpcs.academy_adv_purchasable = (a) => ["ai-for-contractors", "business-management"].includes(a.p_subject);
  rpcs.academy_adv_effective_stage = () => 1;
  rpcs.academy_adv_library = () => [{ subjects: 2, lessons: 14, paid_lessons: 12 }];
  rpcs.academy_adv_find_user = () => null;
  rpcs.academy_adv_admin_summary = () => ({ qualifying: 7, founding_total: 8, founding_disqualified: 1, members: 7, by_plan: { one_subject: 2, two_subjects: 3, all_access: 2 }, by_stage: { 1: 7 },
    mrr_cents: 2 * 999 + 3 * 1499 + 2 * 2999, past_due: 1, canceling: 1, churned_30d: 1, paid_30d_cents: 11_490, paid_invoices_30d: 8, failed_30d: 1, refunded_cents: 999, disputes_open: 0, disputes_lost: 0,
    all_access_members: 2, conversions: 1, upgrades: 1, open_quotes: 2, learners_30d: 9, completions_30d: 41, grants_active: 0, issues_open: 1 });
  const prevOutline = rpcs.academy_course_outline;
  rpcs.academy_course_outline = (a) => {
    const ls = lessons.filter((l) => l.course_id === a.p_course_id);
    if (!ls.length) return typeof prevOutline === "function" ? prevOutline(a) : prevOutline ?? [];
    return ls.map((l) => ({ id: l.id, slug: l.slug, title: l.title, summary: l.summary, module_id: null, module_title: l.module, access: l.access,
      locked: l.access === "advanced" && !has(l.course_id), estimated_minutes: l.estimated_minutes, sort_order: l.sort_order, completed: false }));
  };
  return { set, get state() { return state; } };
}
