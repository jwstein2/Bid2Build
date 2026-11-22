// Academy monthly challenge screenshots (scripts/academy/challenge-shots.mjs). Canned learner states for the mock
// Supabase in scripts/ux-audit/mock-supabase.mjs. Switch with GET /__challenge?state=fresh|progress|earned|admin.
export function installChallenge({ rpcs, tables, iso, USER }) {
  const C = (n, title, slug, lessons) => ({ id: `55555555-5555-4555-8555-00000000000${n}`, slug, trade_slug: null, pillar: "sales", title, summary: "Win more of the right jobs.", description: null,
    level: "beginner", access: "public", status: "published", content_class: "original", cover_path: null, cover_theme: ["navy", "cyan", "amber", "green", "slate", "rose", "navy"][n % 7],
    featured: false, sort_order: n, planned_lessons: [], seo_title: null, seo_description: null, academy_lessons: [{ count: lessons }] });
  const courses = [C(1, "Contractor Sales Academy", "contractor-sales-academy", 12), C(2, "Roofing Sales", "roofing-sales", 1), C(3, "Concrete Sales", "concrete-sales", 1),
    C(4, "Interior Remodeling Sales", "interior-remodeling-sales", 1), C(5, "Painting Sales", "painting-sales", 1), C(6, "Landscaping Sales", "landscaping-sales", 1), C(7, "General Contracting Sales", "general-contracting-sales", 1)];
  tables.academy_courses = courses;
  const month = new Date().toISOString().slice(0, 7) + "-01";
  const topics = [["general-contracting", "General Contracting", 61], ["safety", "Jobsite Safety (OSHA and EPA)", 81], ["business-setup", "Business Setup", 29], ["concrete", "Concrete", 25],
    ["minnesota", "Minnesota Permits and Residential Code", 59], ["roofing", "Roofing", 20], ["hvac", "HVAC", 3]].map(([slug, title, pool]) => ({ slug, title, pool }));
  const t = (c, d) => ({ course_id: c.id, title: c.title, slug: c.slug, completed_at: iso(d), fast: false });
  const base = { rules: {}, total_trainings: 0, available_trainings: 7, quizzes_passed: 0, excluded: null, reward: null, email_used: false, milestones: [], history: [], topics };
  const states = {
    fresh: { ...base, month: { month, trainings: [], trainings_done: 0, course_ids: [], quiz_status: "not_started", quiz_pass: null, quiz_latest: null, open_attempt: null, qualified: false } },
    progress: { ...base, total_trainings: 3, quizzes_passed: 0, history: [{ month, trainings: 2 }],
      milestones: [{ badge: "trainings:1", label: "First Academy training completed", awarded_at: iso(9) }, { badge: "course:roofing-sales", label: "Completed Roofing Sales", awarded_at: iso(2) }],
      month: { month, trainings: [t(courses[1], 2), t(courses[2], 1)], trainings_done: 2, course_ids: [], quiz_status: "failed", quiz_pass: null,
        quiz_latest: { correct: 14, finished_at: iso(1), passed: false }, open_attempt: null, qualified: false } },
    earned: { ...base, total_trainings: 5, quizzes_passed: 1, history: [{ month, trainings: 5 }],
      milestones: [{ badge: "trainings:1", label: "First Academy training completed", awarded_at: iso(9) }, { badge: "trainings:5", label: "5 Academy trainings completed", awarded_at: iso(1) },
        { badge: "challenge:quiz-passed", label: "Passed an Academy challenge quiz", awarded_at: iso(1) }, { badge: "challenge:free-month", label: "Earned the Academy free month", awarded_at: iso(1) }],
      reward: { id: "66666666-6666-4666-8666-000000000001", status: "applied", action: "comp_days", month, qualified_at: iso(1), activates_at: iso(1), expires_at: iso(-29), applied_at: iso(1), credit_cents: null },
      month: { month, trainings: courses.slice(1, 6).map((c, i) => t(c, 6 - i)), trainings_done: 5, course_ids: [], quiz_status: "passed",
        quiz_pass: { attempt_id: "x", correct: 18, finished_at: iso(1), topic: "safety", flags: [] }, quiz_latest: { correct: 18, finished_at: iso(1), passed: true }, open_attempt: null, qualified: true } },
  };
  let state = "progress";
  const completions = () => (states[state].month.trainings.map((x) => ({ user_id: USER.id, course_id: x.course_id })));
  rpcs.academy_me = () => ({ signed_in: true, member: true, status: "active", role: state === "admin" ? "admin" : "member", display_name: "Alex R.", trades: ["roofing"], points: 40, level: 2 });
  rpcs.academy_challenge_status = () => states[state === "admin" ? "earned" : state];
  rpcs.academy_my_progress = () => [];
  const qs = Array.from({ length: 20 }, (_, i) => ({ id: `77777777-7777-4777-8777-0000000000${String(i).padStart(2, "0")}`, prompt: `Sample challenge question ${i + 1}: which control keeps a crew safe at an unprotected edge six feet up?`, options: ["Guardrail, safety net or personal fall arrest", "A warning cone", "A verbal reminder", "Nothing below 10 feet"] }));
  rpcs.academy_challenge_quiz_start = () => ({ attempt_id: "88888888-8888-4888-8888-000000000001", topic: "safety", started_at: iso(0), expires_at: new Date(Date.now() + 3600e3).toISOString(), questions: qs, resumed: false });
  rpcs.academy_challenge_quiz_submit = (a) => ({ correct: 18, total: 20, passed: true, expired: false, pass_correct: 16, claim: { state: "qualified", status: "pending", action: "comp_days" },
    review: qs.map((q, i) => ({ id: q.id, picked: Object.values(a.p_answers ?? {})[i] ?? null, correct: 0, explanation: "OSHA requires fall protection at 6 feet in construction.", citation: "29 CFR 1926.501(b)(1)" })) });
  rpcs.admin_academy_rewards = () => ({ month, totals: { qualified: 3, applied: 1, review: 2, failed: 0, learners_month: 14, trainings_month: 31, quizzes_month: 19, passed_month: 9 },
    rewards: [
      { id: "a1", status: "applied", action: "comp_days", review_reason: null, flags: [], month, qualified_at: iso(1), applied_at: iso(1), activates_at: iso(1), expires_at: iso(-29), credit_cents: null, stripe_ref: null, grant_id: "g", error: null, tries: 1, quiz_correct: 18, email: "pat@roofco.example", tier: "free" },
      { id: "a2", status: "review", action: null, review_reason: "monthly_credit_needs_approval", flags: [], month, qualified_at: iso(2), applied_at: null, activates_at: null, expires_at: null, credit_cents: null, stripe_ref: null, grant_id: null, error: null, tries: 1, quiz_correct: 17, email: "sam@decks.example", tier: "unlimited" },
      { id: "a3", status: "review", action: null, review_reason: "suspicious_activity", flags: ["fast_quiz"], month, qualified_at: iso(3), applied_at: null, activates_at: null, expires_at: null, credit_cents: null, stripe_ref: null, grant_id: null, error: null, tries: 0, quiz_correct: 20, email: "quick@example.org", tier: "free" }],
    close: [{ email: "lee@paint.example", trainings: 3, quiz_passed: true }, { email: "kim@concrete.example", trainings: 2, quiz_passed: false }],
    suspicious: [{ kind: "quiz", email: "quick@example.org", what: "Jobsite Safety (20/20)", at: iso(3), lessons: null, seconds: 41 }],
    events: [{ id: 3, reward_id: "a1", action: "applied", details: {}, created_at: iso(1), email: "pat@roofco.example", actor: null }, { id: 2, reward_id: "a2", action: "review", details: {}, created_at: iso(2), email: "sam@decks.example", actor: null }] });
  return {
    handle(u, res, send) {
      if (u.pathname !== "/__challenge") return false;
      state = u.searchParams.get("state") ?? state;
      tables.academy_course_completions = completions();
      send(res, 200, { state });
      return true;
    },
    init() { tables.academy_course_completions = completions(); },
  };
}
