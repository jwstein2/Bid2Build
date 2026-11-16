// Local stand-in for Supabase used ONLY to render signed-in pages for UX screenshots.
// Answers /auth/v1/user and simple PostgREST reads/RPCs with canned test data. Never point production at it.
import http from "node:http";
import { handleRadarRest, radarRestEnabled } from "../radar/pg-rest.mjs";

const PORT = Number(process.env.MOCK_PORT ?? 54321);
const NOW = Date.now();
const iso = (d = 0) => new Date(NOW - d * 864e5).toISOString();
export const USER = {
  id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated",
  email: "ux-test@built2bid.test", email_confirmed_at: iso(30), created_at: iso(30), app_metadata: {}, user_metadata: {},
};
const EST = "11111111-1111-4111-8111-111111111111";
const G = (n) => `22222222-2222-4222-8222-00000000000${n}`;
const item = (n, g, name, cost_type, qty, unit, cost, sort) => ({
  id: `33333333-3333-4333-8333-0000000000${String(n).padStart(2, "0")}`, estimate_id: EST, group_id: G(g), name, description: null, category: null,
  cost_type, treatment: "marked_up", quantity: qty, unit, unit_cost: cost, taxable: true, pricing_mode: null, pricing_percent: null,
  show_on_proposal: true, notes: null, sort_order: sort,
});

const tables = {
  pm_editors: [],
  business_profiles: process.env.MOCK_EMPTY_PROFILE ? [] : [{ user_id: USER.id, company_name: "Summit Exteriors LLC", contact_name: "Alex Rivera", email: "office@summit.test", phone: "(555) 010-2030", address: "120 Main St, Springfield", website: null, license_number: "CBC-12345", logo_path: null, accent_color: "#00C2E0", default_terms: null, default_payment_terms: null }],
  estimates: [
    { id: EST, user_id: USER.id, title: "Siding replacement – Johnson residence", customer_name: "Pat Johnson", customer_email: "pat@example.test", customer_phone: null, project_address: "48 Oak Lane", customer_notes: null, trades: ["siding"], status: "draft", updated_at: iso(0), estimate_number: "B-1004", estimate_date: iso(0).slice(0, 10), expiration_date: iso(-30).slice(0, 10), location_zip: null, location_city: null, location_state: null, pricing_mode: "markup", pricing_percent: 25, fixed_adjustment: 0, adjustment_label: null, tax_rate: 0, display_mode: "itemized", default_group_visibility: "itemized", template_trade: "siding", template_version: 1, customer_id: null, proposal_config: null },
    { id: "11111111-1111-4111-8111-111111111112", title: "Deck rebuild – Lee", customer_name: "Morgan Lee", trades: ["decks"], status: "finalized", updated_at: iso(3), estimate_number: "B-1003" },
    { id: "11111111-1111-4111-8111-111111111113", title: "Kitchen remodel with a very long descriptive project title to test wrapping", customer_name: "Sam Ortiz-Washington", trades: ["kitchen-remodeling"], status: "draft", updated_at: iso(8), estimate_number: "B-1002" },
  ],
  estimate_versions: [{ id: "44444444-4444-4444-8444-000000000001", estimate_id: "11111111-1111-4111-8111-111111111112", version_number: 1, total: 18450.5, created_at: iso(3) }],
  estimate_groups: [
    { id: G(1), estimate_id: EST, name: "Tear-off & prep", description: null, visibility: null, sort_order: 0, pricing_mode: null, pricing_percent: null },
    { id: G(2), estimate_id: EST, name: "Siding installation", description: null, visibility: null, sort_order: 1, pricing_mode: null, pricing_percent: null },
    { id: G(3), estimate_id: EST, name: "Trim & accessories", description: null, visibility: null, sort_order: 2, pricing_mode: null, pricing_percent: null },
    { id: G(4), estimate_id: EST, name: "Cleanup & disposal", description: null, visibility: null, sort_order: 3, pricing_mode: null, pricing_percent: null },
  ],
  estimate_items: [
    item(1, 1, "Remove existing siding", "labor", 18, "square", 65, 0),
    item(2, 1, "House wrap", "material", 20, "square", 32, 1),
    item(3, 2, "Vinyl siding panels", "material", 20, "square", 145, 0),
    item(4, 2, "Siding install labor", "labor", 20, "square", 120, 1),
    item(5, 3, "J-channel", "material", 240, "linear foot", 1.1, 0),
  ],
  customers: [{ id: "55555555-5555-4555-8555-000000000001", user_id: USER.id, name: "Pat Johnson", email: "pat@example.test", phone: "(555) 333-4444", address: "48 Oak Lane", notes: null, created_at: iso(10), updated_at: iso(1) }],
  saved_items: [
    { id: "66666666-6666-4666-8666-000000000001", user_id: USER.id, name: "Dumpster rental (20 yd)", cost_type: "equipment", unit: "each", unit_cost: 450, treatment: "marked_up", taxable: true, description: null, trade: null, category: null, quantity: null, created_at: iso(5) },
    { id: "66666666-6666-4666-8666-000000000002", user_id: USER.id, name: "Framing Labor", cost_type: "labor", unit: "square foot", unit_cost: 8, treatment: "marked_up", taxable: false, description: null, trade: "framing", category: "Framing Labor", quantity: null, created_at: iso(4) },
    { id: "66666666-6666-4666-8666-000000000003", user_id: USER.id, name: "Framing Materials", cost_type: "material", unit: "square foot", unit_cost: 10, treatment: "marked_up", taxable: true, description: null, trade: "framing", category: "Framing Materials", quantity: null, created_at: iso(4) },
    { id: "66666666-6666-4666-8666-000000000004", user_id: USER.id, name: "Remove existing siding", cost_type: "labor_material", unit: "square", unit_cost: 70, treatment: "marked_up", taxable: false, description: null, trade: "siding", category: "Tear-off & prep", quantity: null, created_at: iso(3) },
  ],
  assemblies: [], assembly_items: [],
  subscriptions: process.env.MOCK_UNLIMITED ? [{ id: "sub_test", user_id: USER.id, status: "active", plan: "monthly", price_id: "price_test", current_period_end: iso(-20), cancel_at_period_end: false, updated_at: iso(1) }] : [],
  billing_customers: [], profiles: [{ id: USER.id, marketing_opt_in: false, created_at: iso(30) }], market_consent: [],
  estimate_project_profiles: [], trade_templates: [], feature_flags: [], audit_logs: [], import_logs: [], pdf_errors: [],
};

// Project schedules (scripts/schedule/walk.mjs): in-memory stand-ins for the schedule RPCs. The real SQL
// is covered by tests/db/project-schedules.test.ts; this only has to behave like it for the browser walk.
const sched = { list: new Map() };
// Phase 9: /__pm?state={..., permissions: {edit, progress, dependencies, publish, pdf}} narrows what the caller may do.
const schedPerms = () => {
  const c = Boolean(rpcs.my_pm_access?.canEdit);
  return { edit: c, progress: c, dependencies: c, publish: c, pdf: true, ...(rpcs.my_pm_access?.permissions ?? {}) };
};
const scheduleRpc = {
  can_schedule_estimate: () => [200, Boolean(rpcs.my_pm_access?.canEdit)],
  schedule_get: ({ p_schedule_id }) => {
    const s = sched.list.get(p_schedule_id);
    return [200, s ? { schedule: s.row, snapshot: s.snapshot, canEdit: schedPerms().edit || schedPerms().progress, permissions: schedPerms(), tasks: s.tasks, deps: s.deps, revisions: [...s.revisions].reverse() } : null];
  },
  schedule_permissions: () => [200, schedPerms()],
  schedule_list: () => [200, [...sched.list.values()].map((s) => {
    const kids = new Set(s.tasks.map((t) => t.parent_id).filter(Boolean));
    const leaves = s.tasks.filter((t) => !kids.has(t.id));
    const w = leaves.reduce((a, t) => a + t.duration_days, 0);
    return { ...s.row, customer_name: s.snapshot.estimate.customerName, finish_date: s.tasks.reduce((m, t) => (t.planned_end > m ? t.planned_end : m), s.row.start_date),
      progress: w ? Math.round(leaves.reduce((a, t) => a + t.duration_days * t.percent_complete, 0) / w) : 0 };
  })],
  schedule_create: ({ p_estimate_id, p_provisional, p }) => {
    if (!rpcs.my_pm_access?.canEdit) return [403, { code: "42501", message: "forbidden" }];
    const e = tables.estimates.find((x) => x.id === p_estimate_id);
    const existing = [...sched.list.values()].find((x) => x.row.estimate_id === p_estimate_id);
    if (existing) return [409, { code: "23505", message: "schedule_exists", details: existing.row.id }];
    const accepted = ["won", "scheduled", "in_progress", "completed"].includes(e?.pipeline_stage);
    if (!accepted && !p_provisional) return [403, { code: "42501", message: "not_accepted" }];
    const id = crypto.randomUUID();
    const snapshot = { estimate: { id: e.id, title: e.title, number: e.estimate_number, customerName: e.customer_name, projectAddress: e.project_address ?? null }, trades: e.trades ?? [], version: null,
      sections: tables.estimate_groups.filter((g) => g.estimate_id === e.id).map((g) => ({ id: g.id, name: g.name, trade: (e.trades ?? [])[0] ?? null, sortOrder: g.sort_order,
        items: tables.estimate_items.filter((i) => i.group_id === g.id).map((i) => ({ id: i.id, name: i.name, quantity: i.quantity, unit: i.unit, sortOrder: i.sort_order })) })) };
    const keys = {};
    const tasks = p.tasks.map((t) => { const tid = crypto.randomUUID(); keys[t.key] = tid; return taskRow({ ...t, id: tid }); });
    sched.list.set(id, {
      row: { id, estimate_id: e.id, user_id: USER.id, company_id: null, name: p.name, status: "draft", provisional: !accepted, calendar: p.calendar, start_date: p.startDate, target_end_date: p.targetEndDate, progress_method: "duration", revision: 1, updated_at: iso(0) },
      snapshot, tasks, deps: (p.deps ?? []).map((d) => ({ predecessor_id: keys[d.from], successor_id: keys[d.to], lag_days: d.lagDays, max_overlap: d.maxOverlap })),
      revisions: [{ revision: 1, summary: accepted ? "Schedule created as a draft" : "Provisional schedule created (bid not yet accepted)", created_at: iso(0), actor_id: USER.id, changes: [] }],
    });
    tables.project_schedules = [...sched.list.values()].map((x) => x.row);
    return [200, id];
  },
  schedule_save: ({ p_schedule_id, p_base_revision, p }) => {
    const s = sched.list.get(p_schedule_id);
    if (!s || !(schedPerms().edit || schedPerms().progress)) return [403, { code: "42501", message: "forbidden" }];
    if (s.row.revision !== p_base_revision) return [409, { code: "40001", message: "stale_revision", details: String(s.row.revision) }];
    if (p.schedule) {
      const m = p.schedule;
      Object.assign(s.row, { ...(m.status ? { status: m.status } : {}), ...(m.progressMethod ? { progress_method: m.progressMethod } : {}), ...(m.name ? { name: m.name } : {}), ...("targetEndDate" in m ? { target_end_date: m.targetEndDate } : {}) });
    }
    const del = new Set(p.delete ?? []);
    s.tasks = s.tasks.filter((t) => !del.has(t.id));
    const keys = {};
    for (const t of p.tasks ?? []) {
      if (t.id) {
        const i = s.tasks.findIndex((x) => x.id === t.id);
        if (i >= 0) {
          const prev = s.tasks[i]; const next = taskRow(t);
          const keep = prev.resource_id && (next.assignee ?? null) === (prev.assignee ?? null);
          s.tasks[i] = keep ? { ...next, resource_id: prev.resource_id, assignment_status: prev.assignment_status, assignment_inherited: prev.assignment_inherited } : next;
        }
      }
      else {
        if (t.sourceItemId && !t.splitFrom && s.tasks.some((x) => x.source_item_id === t.sourceItemId && !x.split_from)) return [409, { code: "23505", message: "duplicate key value violates unique constraint" }];
        const tid = crypto.randomUUID(); keys[t.key] = tid; s.tasks.push(taskRow({ ...t, id: tid }));
      }
    }
    if (p.deps) s.deps = p.deps.map((d) => ({ predecessor_id: keys[d.from] ?? d.from, successor_id: keys[d.to] ?? d.to, lag_days: d.lagDays, max_overlap: d.maxOverlap }));
    s.row.revision += 1; s.row.updated_at = iso(0);
    s.revisions.push({ revision: s.row.revision, summary: p.summary, created_at: iso(0), actor_id: USER.id, changes: p.changes ?? [] });
    return [200, s.row.revision];
  },
};
// Customer updates (Phase 8): published copies are kept newest first, like the real query's order.
tables.schedule_publications = [];
const pubFind = (id) => tables.schedule_publications.find((x) => x.id === id);
Object.assign(scheduleRpc, {
  schedule_publish: ({ p_schedule_id, p_base_revision, p }) => {
    const s = sched.list.get(p_schedule_id);
    if (!s || !schedPerms().publish) return [403, { code: "42501", message: "forbidden" }];
    if (s.row.revision !== p_base_revision) return [409, { code: "40001", message: "stale_revision", details: String(s.row.revision) }];
    const version = tables.schedule_publications.filter((x) => x.schedule_id === p_schedule_id).length + 1;
    const row = { id: crypto.randomUUID(), schedule_id: p_schedule_id, estimate_id: s.row.estimate_id, version, schedule_revision: s.row.revision, published_at: new Date().toISOString(),
      published_by: USER.id, publisher_name: p.publisherName ?? null, options: p.options, content: p.content, content_hash: p.contentHash, logo_path: p.logoPath ?? null,
      token_hash: null, link_created_at: null, link_expires_at: null, link_revoked_at: null, view_count: 0, last_viewed_at: null, delivery: [] };
    tables.schedule_publications.unshift(row);
    return [200, { id: row.id, version, publishedAt: row.published_at }];
  },
  schedule_publication_link: ({ p_publication_id, p_token_hash, p_days }) => {
    const r = pubFind(p_publication_id);
    if (!r || !schedPerms().publish) return [403, { code: "42501", message: "forbidden" }];
    Object.assign(r, { token_hash: p_token_hash, link_created_at: new Date().toISOString(), link_expires_at: new Date(Date.now() + (p_days ?? 30) * 864e5).toISOString(), link_revoked_at: null });
    r.delivery = [...r.delivery, { method: "link_created", at: new Date().toISOString(), by: USER.id }];
    return [200, r.link_expires_at];
  },
  schedule_publication_revoke_link: ({ p_publication_id }) => {
    const r = pubFind(p_publication_id);
    if (!r || !schedPerms().publish) return [403, { code: "42501", message: "forbidden" }];
    if (r.token_hash && !r.link_revoked_at) r.link_revoked_at = new Date().toISOString();
    return [200, null];
  },
  schedule_publication_delivery: ({ p_publication_id, p_method }) => {
    const r = pubFind(p_publication_id);
    if (!r || !schedPerms().publish) return [403, { code: "42501", message: "forbidden" }];
    r.delivery = [...r.delivery, { method: p_method, at: new Date().toISOString(), by: USER.id }];
    return [200, null];
  },
});

// Projects workspace V4.1 (scripts/projects/walk.mjs): pm_workspace and friends over the same in-memory
// schedules. Real SQL: tests/db/projects-workspace.test.ts. /__ws?seed=1 adds several overlapping projects.
const wsPeople = [{ id: USER.id, name: "Alex Rivera", role: "owner" }, { id: "00000000-0000-4000-8000-0000000000a2", name: "Jordan Sales", role: "estimator" }, { id: "00000000-0000-4000-8000-0000000000a3", name: "Pat Manager", role: "manager" }];
const wsActivity = new Map();
const logAct = (sid, kind, summary, audience = "internal") => wsActivity.set(sid, [{ kind, audience, summary, actor: USER.id, at: new Date().toISOString() }, ...(wsActivity.get(sid) ?? [])]);
Object.assign(scheduleRpc, {
  pm_people: () => [200, wsPeople],
  pm_workspace: ({ p_from, p_to }) => {
    const all = [...sched.list.values()];
    const perms = schedPerms();
    return [200, {
      me: USER.id, people: wsPeople, from: p_from, to: p_to,
      projects: all.filter((s) => s.row.status !== "archived").map((s) => {
        const kids = new Set(s.tasks.map((t) => t.parent_id).filter(Boolean));
        const leaves = s.tasks.filter((t) => !kids.has(t.id));
        const w = leaves.reduce((a, t) => a + t.duration_days, 0);
        const today = new Date().toISOString().slice(0, 10);
        const pubs = (tables.schedule_publications ?? []).filter((x) => x.schedule_id === s.row.id);
        return { ...s.row, owner_id: s.row.user_id, sales_rep_id: s.row.sales_rep_id ?? s.row.user_id, project_manager_id: s.row.project_manager_id ?? null,
          customer_name: s.snapshot.estimate.customerName, trades: s.snapshot.trades, finish_date: s.tasks.reduce((m, t) => (t.planned_end > m ? t.planned_end : m), s.row.start_date),
          tasks_total: leaves.length, tasks_done: leaves.filter((t) => t.status === "complete").length, tasks_delayed: leaves.filter((t) => t.status === "delayed").length,
          tasks_overdue: leaves.filter((t) => t.status !== "complete" && t.planned_end < today).length,
          progress: w ? Math.round(leaves.reduce((a, t) => a + t.duration_days * t.percent_complete, 0) / w) : 0,
          last_update_at: pubs[0]?.published_at ?? null, last_change_at: s.row.updated_at, permissions: perms };
      }),
      tasks: all.filter((s) => s.row.status !== "archived").flatMap((s) => s.tasks.filter((t) => t.planned_end >= p_from && t.planned_start <= p_to).map((t) => ({ ...t, schedule_id: s.row.id,
        section_trade: s.snapshot.sections.find((g) => g.id === t.source_group_id)?.trade ?? null }))),
      deps: all.flatMap((s) => s.deps.map((d) => ({ from: d.predecessor_id, to: d.successor_id, lagDays: d.lag_days }))),
    }];
  },
  project_activity_feed: ({ p_schedule_id }) => {
    const s = sched.list.get(p_schedule_id);
    if (!s) return [200, []];
    const fromRev = s.revisions.map((r) => ({ kind: r.revision === 1 ? "schedule_created" : "schedule_changed", audience: "internal", summary: r.summary, actor: r.actor_id, at: r.created_at }));
    return [200, [...(wsActivity.get(p_schedule_id) ?? []), ...fromRev.reverse()]];
  },
  schedule_set_people: ({ p_schedule_id, p_sales_rep, p_project_manager }) => {
    const s = sched.list.get(p_schedule_id);
    if (!s || !schedPerms().edit) return [403, { code: "42501", message: "forbidden" }];
    s.row.sales_rep_id = p_sales_rep; s.row.project_manager_id = p_project_manager;
    logAct(p_schedule_id, "people_changed", p_project_manager ? "Project manager assigned" : "Project manager removed");
    return [200, null];
  },
  schedule_closeout: ({ p_schedule_id, p_base_revision, p_actual_finish, p_override_reason }) => {
    const s = sched.list.get(p_schedule_id);
    if (!s || !schedPerms().edit) return [403, { code: "42501", message: "forbidden" }];
    if (s.row.revision !== p_base_revision) return [409, { code: "40001", message: "stale_revision", details: String(s.row.revision) }];
    const kids = new Set(s.tasks.map((t) => t.parent_id).filter(Boolean));
    const open = s.tasks.filter((t) => !kids.has(t.id) && t.status !== "complete").length;
    if (open && !p_override_reason) return [400, { code: "22023", message: "incomplete_tasks", details: String(open) }];
    Object.assign(s.row, { status: "completed", actual_finish: p_actual_finish, closeout_note: p_override_reason ?? null, revision: s.row.revision + 1 });
    logAct(p_schedule_id, "project_completed", "Project completed");
    return [200, s.row.revision];
  },
  schedule_reopen: ({ p_schedule_id, p_base_revision }) => {
    const s = sched.list.get(p_schedule_id);
    if (!s || !schedPerms().edit) return [403, { code: "42501", message: "forbidden" }];
    if (s.row.revision !== p_base_revision) return [409, { code: "40001", message: "stale_revision", details: String(s.row.revision) }];
    Object.assign(s.row, { status: "active", revision: s.row.revision + 1 });
    logAct(p_schedule_id, "project_reopened", "Project reopened");
    return [200, s.row.revision];
  },
});
// Team & Subcontractors V4.2 (scripts/projects/team-walk.mjs). Real SQL: tests/db/team-assignments.test.ts.
const team = { canManage: true, list: [] };
Object.defineProperty(tables, "pm_resources", { get: () => team.list.map((r) => ({ id: r.id, name: r.name, phone: r.phone, email: r.email, status: r.status })), configurable: true });
Object.defineProperty(tables, "schedule_tasks", { get: () => [...sched.list.values()].flatMap((x) => x.tasks.map((t) => ({ ...t, schedule_id: x.row.id }))), configurable: true });
Object.assign(scheduleRpc, {
  pm_team: () => [200, { companyId: "c0000000-0000-4000-8000-000000000001", canManage: team.canManage && schedPerms().edit, resources: team.list }],
  pm_resource_save: ({ p }) => {
    if (!team.canManage || !schedPerms().edit) return [403, { code: "42501", message: "forbidden" }];
    if (!p?.name?.trim()) return [400, { code: "22023", message: "name_required" }];
    const trades = [...new Set((p.trades ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean))];
    const fields = { kind: p.kind, name: p.name.trim(), contactName: p.contactName ?? null, linkedUserId: p.kind === "staff" ? p.linkedUserId ?? null : null, trades, email: p.email ?? null,
      phone: p.phone ?? null, notes: p.notes ?? null, capacity: p.capacity ?? 1, unavailable: p.unavailable ?? [], ...(p.kind === "crew" ? { members: p.members ?? [] } : {}) };
    if (p.id) { const r = team.list.find((x) => x.id === p.id); if (!r) return [404, { code: "42501", message: "not_found" }]; Object.assign(r, fields, { kind: r.kind }); return [200, r.id]; }
    const r = { id: crypto.randomUUID(), status: "active", members: [], ...fields };
    team.list.push(r);
    return [200, r.id];
  },
  pm_resource_set_status: ({ p_id, p_status }) => {
    const r = team.list.find((x) => x.id === p_id);
    if (!r || !team.canManage) return [403, { code: "42501", message: "forbidden" }];
    r.status = p_status;
    if (p_status === "archived") for (const c of team.list) c.members = (c.members ?? []).filter((m) => m !== p_id);
    return [200, null];
  },
  schedule_assign: ({ p_schedule_id, p_base_revision, p_items, p_summary }) => {
    const s = sched.list.get(p_schedule_id);
    if (!s || !schedPerms().edit) return [403, { code: "42501", message: "forbidden" }];
    if (s.row.revision !== p_base_revision) return [409, { code: "40001", message: "stale_revision", details: String(s.row.revision) }];
    for (const it of typeof p_items === "string" ? JSON.parse(p_items) : p_items) {
      const t = s.tasks.find((x) => x.id === it.taskId);
      if (!t) return [400, { code: "22023", message: "bad_task" }];
      const r = it.resourceId ? team.list.find((x) => x.id === it.resourceId && x.status === "active") : null;
      if (it.resourceId && !r) return [400, { code: "22023", message: "bad_resource" }];
      const st = r ? it.status ?? "tentative" : null;
      Object.assign(t, { resource_id: r?.id ?? null, assignee: r?.name ?? null, assignment_status: st, assignment_inherited: false, assignment_confirmed_at: st === "confirmed" ? iso(0) : null });
      if (t.kind === "section") for (const c of s.tasks.filter((x) => x.parent_id === t.id && (x.assignment_inherited || (!x.resource_id && !x.assignee))))
        Object.assign(c, { resource_id: r?.id ?? null, assignee: r?.name ?? null, assignment_status: st, assignment_inherited: Boolean(r) });
    }
    s.row.revision += 1; s.row.updated_at = iso(0);
    s.revisions.push({ revision: s.row.revision, summary: p_summary ?? "Assignments updated", created_at: iso(0), actor_id: USER.id, changes: [] });
    return [200, s.row.revision];
  },
  schedule_set_report_assignees: ({ p_schedule_id, p_mode }) => {
    const s = sched.list.get(p_schedule_id);
    if (!s || !(schedPerms().edit || schedPerms().publish)) return [403, { code: "42501", message: "forbidden" }];
    s.row.report_assignees = p_mode;
    return [200, null];
  },
  pm_task_assignments: ({ p_from, p_to }) => [200, [...sched.list.values()].flatMap((x) => x.tasks.filter((t) => t.resource_id && t.planned_end >= p_from && t.planned_start <= p_to)
    .map((t) => ({ id: t.id, resourceId: t.resource_id, status: t.assignment_status ?? null, inherited: !!t.assignment_inherited })))],
});
function seedTeam() {
  team.list = [];
  const add = (o) => { const r = { id: crypto.randomUUID(), status: "active", contactName: null, linkedUserId: null, trades: [], email: null, phone: null, notes: null, capacity: 1, unavailable: [], members: [], ...o }; team.list.push(r); return r; };
  const alex = add({ kind: "staff", name: "Alex Rivera", linkedUserId: USER.id, trades: ["cabinets"], phone: "555-0101" });
  const jose = add({ kind: "staff", name: "Jose Martinez", trades: ["siding", "demolition"], phone: "555-0102" });
  add({ kind: "crew", name: "Crew A", trades: ["siding", "demolition"], members: [jose.id] });
  add({ kind: "subcontractor", name: "Stone Works", contactName: "Sam Stone", trades: ["countertops"], email: "sam@stoneworks.test", phone: "555-0110" });
  add({ kind: "subcontractor", name: "ABC Supply", trades: ["siding"], email: "orders@abc.test" });
  add({ kind: "subcontractor", name: "Peak Roofing", contactName: "Dana", trades: ["roofing"], phone: "555-0120" });
  return alex;
}

function seedWorkspace() {
  const day = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
  const jobs = [
    { name: "Full Siding Replacement", customer: "John Dont", trade: "siding", rep: USER.id, pm: wsPeople[2].id, start: -3, secs: [["Removal", 3, "Crew A", "in_progress"], ["Siding Materials", 3, "ABC Supply", "in_progress"], ["Labor", 8, "Crew A", "not_started"]] },
    { name: "Kitchen Remodel – Ortiz", customer: "Sam Ortiz", trade: "kitchen-remodeling", rep: wsPeople[1].id, pm: wsPeople[2].id, start: 1, secs: [["Demolition", 2, "Crew A", "not_started"], ["Cabinets", 4, "Alex Rivera", "not_started"], ["Countertops", 2, "Stone Works", "not_started"]] },
    { name: "Deck Rebuild – Lee", customer: "Morgan Lee", trade: "decks", rep: wsPeople[1].id, pm: null, start: -10, secs: [["Tear-off", 2, "Crew B", "complete"], ["Framing", 4, "Crew B", "delayed"], ["Decking & rails", 4, null, "not_started"]] },
    { name: "Roof Replacement – Patel", customer: "Riya Patel", trade: "roofing", rep: USER.id, pm: USER.id, start: 12, secs: [["Tear-off", 2, "Crew B", "not_started"], ["Install", 4, "Crew B", "not_started"]] },
  ];
  for (const j of jobs) {
    const id = crypto.randomUUID();
    let cursor = j.start; const tasks = []; const deps = [];
    j.secs.forEach(([n, d, who, st], i) => {
      const s0 = day(cursor); let e = s0; let c = 1; const dt = new Date(`${s0}T00:00:00Z`);
      while (c < d) { dt.setUTCDate(dt.getUTCDate() + 1); if (![0, 6].includes(dt.getUTCDay())) c++; }
      e = dt.toISOString().slice(0, 10);
      const tid = crypto.randomUUID();
      tasks.push(taskRow({ id: tid, kind: "section", sourceGroupId: crypto.randomUUID(), name: n, sortOrder: i, plannedStart: s0, plannedEnd: e, durationDays: d, assignee: who,
        status: st, percentComplete: st === "complete" ? 100 : st === "in_progress" ? 40 : st === "delayed" ? 30 : 0, actualStart: st !== "not_started" ? s0 : null, actualFinish: st === "complete" ? e : null }));
      if (i) deps.push({ predecessor_id: tasks[i - 1].id, successor_id: tid, lag_days: 0, max_overlap: 0 });
      cursor += Math.round(d * 1.4);
    });
    sched.list.set(id, { row: { id, estimate_id: crypto.randomUUID(), user_id: USER.id, company_id: "c0000000-0000-4000-8000-000000000001", name: j.name, status: j.start < 0 ? "active" : "draft", provisional: false,
      calendar: { workdays: [1, 2, 3, 4, 5], holidays: [], timezone: "America/Chicago" }, start_date: tasks[0].planned_start, target_end_date: null, progress_method: "duration", revision: 1, updated_at: iso(0),
      sales_rep_id: j.rep, project_manager_id: j.pm },
      snapshot: { estimate: { id, title: j.name, number: "B-2001", customerName: j.customer, projectAddress: null }, trades: [j.trade], version: null, sections: tasks.map((t) => ({ id: t.source_group_id, name: t.name, trade: j.trade, sortOrder: t.sort_order, items: [] })) },
      tasks, deps, revisions: [{ revision: 1, summary: "Schedule created as a draft", created_at: iso(2), actor_id: USER.id, changes: [] }] });
  }
  tables.project_schedules = [...sched.list.values()].map((x) => x.row);
}

const taskRow = (t) => ({
  id: t.id, parent_id: t.kind === "item" ? t.parentId ?? null : null, kind: t.kind, source_group_id: t.sourceGroupId, source_item_id: t.sourceItemId ?? null, split_from: t.splitFrom ?? null,
  name: t.name, sort_order: t.sortOrder ?? 0, planned_start: t.plannedStart, planned_end: t.plannedEnd, duration_days: t.durationDays, actual_start: t.actualStart ?? null,
  actual_finish: t.actualFinish ?? null, percent_complete: t.percentComplete ?? 0, status: t.status ?? "not_started", weight: t.weight ?? null, assignee: t.assignee ?? null, notes: t.notes ?? null,
});

const rpcs = {
  is_admin: process.env.MOCK_ADMIN === "1",
  credit_status: [{ starter_balance: 2, starter_total: 3, monthly_balance: 0, monthly_eligible: false, next_cycle_at: iso(-12), unlimited: Boolean(process.env.MOCK_UNLIMITED), email_verified: true, starter_granted: true }],
  save_estimate: { id: EST }, market_log_view: null,
  // Saved Items & Pricing Library entitlement (Unlimited or admin).
  library_access: Boolean(process.env.MOCK_UNLIMITED) || process.env.MOCK_ADMIN === "1",
};

// Admin command center screenshots: synthetic platform-wide data (scripts/admin-cc/seed.mjs).
let authAdminUsers = null;
if (process.env.MOCK_COMMAND_CENTER) {
  const { commandCenterSeed } = await import("../admin-cc/seed.mjs");
  const seed = commandCenterSeed(USER.id);
  Object.assign(tables, seed.tables);
  rpcs.admin_metrics = seed.adminMetrics;
  rpcs.admin_platform_usage = { db_bytes: 17_192_627, auth_users: 24, buckets: [{ bucket: "documents", objects: 15, bytes: 1_081_580 }, { bucket: "logos", objects: 3, bytes: 464_838 }], measured_at: new Date().toISOString() };
  // Read-only stand-in for admin_comp_list so the Complimentary Access screen can be screenshotted.
  const compRow = (g, state, name) => ({ id: g.id, email: g.email, user_id: g.user_id, plan: g.plan, state, status: g.status, duration_days: g.plan === "enterprise" ? 90 : 30, included_seats: g.plan === "enterprise" ? 3 : 1, extra_seats: 0, company_id: null, starts_at: g.starts_at, expires_at: g.expires_at, paused_at: null, activated_at: g.starts_at, invite_expires_at: g.invite_expires_at, invite_sent_at: g.created_at, invite_send_count: 1, note: g.note, created_at: g.created_at, revoked_at: null, revoke_reason: null, granted_by_email: USER.email, account_name: name, last_activity_at: null, paid_now: false, converted: false });
  const [g1, g2, g3] = seed.tables.complimentary_grants;
  rpcs.admin_comp_list = { rows: [compRow(g2, "active", "Motor City Baths (demo)"), compRow(g1, "active", "Steel City Kitchens (demo)"), compRow(g3, "pending", null)], metrics: { active: 2, pending: 1, expiring_soon: 1, expired: 0, invite_expired: 1, revoked: 0, paused: 0, unlimited: 2, enterprise: 1, converted: 0, total: 3 } };
  authAdminUsers = [{ id: USER.id, aud: "authenticated", role: "authenticated", email: USER.email, created_at: "2026-11-01T00:00:00Z", email_confirmed_at: "2026-11-01T00:00:00Z", last_sign_in_at: new Date().toISOString(), app_metadata: {}, user_metadata: {} }, ...seed.authUsers];
}

// Account scenarios for the account-aware CTA checks (scripts/account-ctas/run.mjs). Switch at runtime with
// GET /__scenario?name=<key>&authDelayMs=<n>. MOCK_UNLIMITED keeps its old meaning for the UX audit scripts.
const sub = (o) => [{ stripe_subscription_id: "sub_test", id: "sub_test", user_id: USER.id, status: "active", plan: "monthly", price_id: "price_test", current_period_end: iso(-20), cancel_at_period_end: false, canceled_at: null, ended_at: null, updated_at: iso(1), ...o }];
const COMPANY = "55555555-5555-4555-8555-000000000001";
const ALL_PERMS = ["view_own_bids", "view_team_bids", "view_company_bids", "create_estimates", "edit_team_estimates", "view_costs", "view_margin", "approve_bids", "manage_company_pricing", "view_analytics", "manage_teams", "manage_users", "manage_billing",
  "view_schedules", "create_schedules", "edit_assigned_schedules", "edit_all_schedules", "manage_dependencies", "update_progress", "publish_customer_updates", "download_schedule_pdf",
  "view_internal_reports", "download_internal_reports", "send_internal_reports", "manage_pm_seats", "manage_pm_addons"];
const company = (role, o) => ({ id: COMPANY, name: "Summit Exteriors LLC", role, isOwner: role === "owner", permissions: role === "owner" ? ALL_PERMS : ["view_own_bids", "create_estimates", "view_costs"], entitlement: { active: true, source: "stripe", seatLimit: 5, expiresAt: null }, seatsUsed: 3, ...o });
const credit = (o) => [{ starter_balance: 2, starter_total: 3, monthly_balance: 0, monthly_eligible: false, next_cycle_at: iso(-12), unlimited: false, email_verified: true, starter_granted: true, ...o }];
export const SCENARIOS = {
  starter: { credit: credit({}), subs: [] },
  monthly: { credit: credit({ starter_balance: 0, monthly_balance: 1, monthly_eligible: true }), subs: [] },
  unlimited: { credit: credit({ unlimited: true }), subs: sub({}) },
  canceling: { credit: credit({ unlimited: true }), subs: sub({ cancel_at_period_end: true, canceled_at: iso(2) }) },
  expired: { credit: credit({ starter_balance: 0, monthly_balance: 0, monthly_eligible: true }), subs: sub({ status: "canceled", current_period_end: iso(3), ended_at: iso(3), canceled_at: iso(30) }) },
  zero: { credit: credit({ starter_balance: 0, monthly_balance: 0, monthly_eligible: true }), subs: [] },
  // Enterprise: owner with 5 licensed users (4 in use), a member without billing rights, a complimentary company.
  enterprise_owner: { credit: credit({ unlimited: true }), subs: sub({ plan: "enterprise", company_id: COMPANY, seat_quantity: 5, price_id: "price_ent_base" }), company: company("owner", { seatsUsed: 4, entitlement: { active: true, source: "stripe", seatLimit: 5, expiresAt: iso(-20) } }) },
  enterprise_estimator: { credit: credit({ unlimited: true }), subs: [], company: company("estimator", {}) },
  enterprise_comp: { credit: credit({ unlimited: true }), subs: [], company: company("owner", { entitlement: { active: true, source: "complimentary", seatLimit: 3, expiresAt: iso(-30) } }) },
  enterprise_past_due: { credit: credit({ unlimited: true }), subs: sub({ status: "past_due", plan: "enterprise", company_id: COMPANY, seat_quantity: 5 }), company: company("owner", { seatsUsed: 4, entitlement: { active: true, source: "stripe", seatLimit: 5, expiresAt: iso(-20) } }) },
};
const LIBRARY_SEED = JSON.stringify({ saved_items: tables.saved_items, assemblies: tables.assemblies, assembly_items: tables.assembly_items });
let authDelayMs = 0;
const otpLog = [];
const KNOWN_PHONES = new Set(["15552345678"]);
const TAKEN_PHONE = "15559990000";
function applyScenario(name) {
  const sc = SCENARIOS[name];
  if (!sc) return false;
  rpcs.credit_status = sc.credit;
  tables.subscriptions = sc.subs;
  rpcs.library_access = Boolean(sc.credit[0].unlimited);
  rpcs.my_company = sc.company ?? null;
  rpcs.company_billing_summary = sc.company ? { activeMembers: Math.max(1, (sc.company.seatsUsed ?? 1) - 1) } : null;
  // Users & Permissions page data (owner sees emails, deactivated people and invitations).
  const owner = sc.company?.role === "owner";
  const TEAM = "55555555-5555-4555-8555-0000000000a1";
  const M2 = "00000000-0000-4000-8000-000000000002", M3 = "00000000-0000-4000-8000-000000000003", M4 = "00000000-0000-4000-8000-000000000004";
  rpcs.company_roster = sc.company ? [
    { user_id: USER.id, display_name: "Jordan Owner", email: USER.email, role: sc.company.role, status: "active", team_ids: [], managed_team_ids: [], joined_at: iso(60), last_active_at: iso(0) },
    { user_id: M2, display_name: "Riley Manager", email: owner ? "riley@summit.test" : null, role: "manager", status: "active", team_ids: [TEAM], managed_team_ids: [TEAM], joined_at: iso(40), last_active_at: iso(1) },
    { user_id: M3, display_name: "Casey Estimator", email: owner ? "casey@summit.test" : null, role: "estimator", status: "active", team_ids: [TEAM], managed_team_ids: [], joined_at: iso(20), last_active_at: iso(2) },
    ...(owner ? [{ user_id: M4, display_name: "Pat Former", email: "pat@summit.test", role: "viewer", status: "deactivated", team_ids: [], managed_team_ids: [], joined_at: iso(90), last_active_at: iso(30) }] : []),
  ] : null;
  rpcs.company_member_access = owner ? [{ user_id: M3, permissions_granted: ["view_analytics"], permissions_revoked: [] }] : null;
  rpcs.company_teams_overview = sc.company ? [{ id: TEAM, name: "Siding Crew", trade: "siding", member_count: 2, manager_count: 1 }] : null;
  rpcs.list_company_invitations = owner ? [{ id: "55555555-5555-4555-8555-0000000000b1", email: "newhire@summit.test", role: "estimator", team_id: null, expires_at: iso(-6), created_at: iso(1) }] : null;
  // Command Center (Overview, Bids & Pipeline, bid review).
  const B1 = "77777777-7777-4777-8777-000000000001", B2 = "77777777-7777-4777-8777-000000000002", B3 = "77777777-7777-4777-8777-000000000003";
  const prow = (id, title, stage, owner, total, margin, o = {}) => ({ id, title, estimate_number: `EST-${id.slice(-3)}`, customer_name: "Pat Homeowner", trades: ["siding"], pipeline_stage: stage, status: "finalized", user_id: owner, owner_name: owner === M3 ? "Casey Estimator" : "Riley Manager", total, margin_pct: owner ? margin : null, created_at: iso(5), updated_at: iso(1), stage_changed_at: iso(1), total_count: 3, ...o });
  rpcs.company_pipeline_bids = sc.company ? [
    prow(B1, "Hillside re-side", "ready_for_review", M3, "18450.00", owner ? "31.5" : null),
    prow(B2, "Oak St gutters", "won", M2, "4200.00", owner ? "28.0" : null),
    prow(B3, "Maple Ave deck", "draft", M3, null, null, { status: "draft" }),
  ] : null;
  rpcs.company_pipeline_summary = sc.company && sc.company.role !== "estimator" ? {
    bids: 3, sent: 1, won: 1, lost: 0, awaitingReview: 1, winRate: 100, wonValue: 4200, openValue: 0, avgBid: 11325, avgMargin: 29.8,
    stages: { draft: { count: 1, value: 0 }, ready_for_review: { count: 1, value: 18450 }, approved: { count: 0, value: 0 }, sent: { count: 0, value: 0 }, pending: { count: 0, value: 0 }, won: { count: 1, value: 4200 }, lost: { count: 0, value: 0 } },
    members: [
      { userId: M2, name: "Riley Manager", status: "active", bids: 1, sent: 1, won: 1, lost: 0, wonValue: 4200, avgBid: 4200, winRate: 100, avgMargin: 28 },
      { userId: M3, name: "Casey Estimator", status: "active", bids: 2, sent: 0, won: 0, lost: 0, wonValue: 0, avgBid: 18450, winRate: null, avgMargin: 31.5 },
    ],
    requireApproval: false,
  } : null;
  rpcs.company_bid_review = sc.company ? {
    id: B1, title: "Hillside re-side", estimateNumber: "EST-001", customerName: "Pat Homeowner", projectAddress: "12 Hillside Rd", trades: ["siding"], stage: "ready_for_review", status: "finalized",
    lostReason: null, userId: M3, isMine: false, ownerName: "Casey Estimator", createdAt: iso(5), updatedAt: iso(1), canSeeCosts: owner,
    version: { number: 2, total: 18450, subtotal: 18450, tax: 0, cost: owner ? 12638 : null, marginPct: owner ? 31.5 : null, createdAt: iso(1) },
    history: [{ from: "draft", to: "ready_for_review", note: "Ready when you are", at: iso(1), by: "Casey Estimator" }],
  } : null;
  rpcs.peek_company_invitation = [{ company_name: "Summit Exteriors LLC", role: "estimator", email_hint: "u•••@built2bid.test", expires_at: iso(-6), email_matches: true }];
  return true;
}
if (process.env.MOCK_SCENARIO) applyScenario(process.env.MOCK_SCENARIO);

const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS", "access-control-expose-headers": "content-range" };
const send = (res, code, body, extra = {}) => { res.writeHead(code, { "content-type": "application/json", ...cors, ...extra }); res.end(body === undefined ? "" : JSON.stringify(body)); };

// Complimentary Access browser walk (scripts/complimentary/walk.mjs): when COMP_PG_URL points at a throwaway
// test database with the real migrations, these RPCs run the real SQL there instead of returning canned data.
// E-signature walk (MOCK_ESIGN_FIXTURE=<json from scripts/esign/fixture.ts>): signing tables, the
// accept/record RPCs and an in-memory storage bucket, so the real signing routes run end to end.
const ESIGN = process.env.MOCK_ESIGN_FIXTURE ? JSON.parse((await import("node:fs")).readFileSync(process.env.MOCK_ESIGN_FIXTURE, "utf8")) : null;
export const ESIGN_TOKEN = "walkTokenAbcdefghijklmnopqrstuvwxyz01234567";
const { createHash } = await import("node:crypto");
const sha = (s) => createHash("sha256").update(s).digest("hex");
const storage = new Map();
const esignRpc = {};
if (ESIGN) {
  const E = (n) => `11111111-1111-4111-8111-11111111111${n}`;
  const V = (n) => `44444444-4444-4444-8444-00000000000${n}`;
  tables.estimates.push(
    { id: E(4), user_id: USER.id, title: "Roof repair – Chen", customer_name: "Lin Chen", trades: ["roofing"], status: "finalized", updated_at: iso(12), estimate_number: "B-1001" },
    { id: E(5), user_id: USER.id, title: "Fence install – Garcia", customer_name: "Maria Garcia", trades: ["fencing"], status: "finalized", updated_at: iso(6), estimate_number: "B-0999" },
  );
  const ver = (id, est, n, total, doc) => ({ id, estimate_id: est, user_id: USER.id, version_number: n, total, created_at: iso(3), proposal: doc, snapshot: { business: {} }, content_hash: "c".repeat(64) });
  tables.estimate_versions = [
    ver(V(1), E(2), 1, 17985, ESIGN.signedDoc),
    ver(V(2), E(1), 1, 17985, ESIGN.pendingDoc),
    ver(V(3), E(4), 1, 6420, ESIGN.signedDoc),
    ver(V(4), E(5), 1, 4310.25, { ...ESIGN.signedDoc, meta: { ...ESIGN.signedDoc.meta, title: "Fence install – Garcia" } }),
  ];
  const reqRow = (id, est, v, status, token, o = {}) => ({ id, estimate_id: est, version_id: v, user_id: USER.id, company_id: null, token_hash: sha(token), document_hash: "d".repeat(64), content_hash: "c".repeat(64), status, expires_at: iso(-20), created_at: iso(2), revoked_at: null, revoke_reason: null, signed_at: null, ...o });
  tables.signing_requests = [
    reqRow("77777777-7777-4777-8777-000000000001", E(2), V(1), "signed", "signed-token", { signed_at: new Date(NOW - 2 * 3600e3).toISOString(), created_at: iso(1) }),
    reqRow("77777777-7777-4777-8777-000000000002", E(1), V(2), "pending", ESIGN_TOKEN),
    reqRow("77777777-7777-4777-8777-000000000003", E(4), V(3), "pending", "expired-token", { expires_at: iso(1), created_at: iso(31) }),
    reqRow("77777777-7777-4777-8777-000000000004", E(5), V(4), "signed", "fence-token", { signed_at: iso(5), created_at: iso(6) }),
  ];
  const sigRow = (id, req, est, v, total, at, name, title, o = {}) => ({ id, request_id: req, estimate_id: est, version_id: v, user_id: USER.id, company_id: null, signer_name: name, signer_email: "john@example.test", method: "typed", signature_text: name, signature_image: null, consent_version: "esign-consent-2026-11-15", consent_text: "I agree to use electronic records and signatures.", acceptance_text: "I accept this proposal.", consented_at: at, document_hash: "d".repeat(64), content_hash: "c".repeat(64), total, version_number: 1, proposal_number: "B-1003", project_title: title, customer_name: name, verification: "link_possession", ip_address: "203.0.113.9", user_agent: "Mozilla/5.0 (iPhone)", signed_at: at, pdf_status: "ready", pdf_path: null, pdf_hash: null, pdf_error: null, pdf_attempts: 1, ...o });
  tables.signatures = [
    sigRow("88888888-8888-4888-8888-000000000001", tables.signing_requests[0].id, E(2), V(1), 17985, new Date(NOW - 2 * 3600e3).toISOString(), "John Smith", "Backyard Deck Replacement", { pdf_status: "failed" }),
    sigRow("88888888-8888-4888-8888-000000000002", tables.signing_requests[3].id, E(5), V(4), 4310.25, iso(5), "Maria Garcia", "Fence install – Garcia"),
  ];
  esignRpc.accept_signing_request = (a) => {
    const r = tables.signing_requests.find((x) => x.token_hash === a.p_token_hash);
    if (!r) return [400, { message: "link_invalid" }];
    if (r.status === "signed") return [400, { message: "already_signed" }];
    if (r.status === "revoked") return [400, { message: "link_revoked" }];
    if (new Date(r.expires_at) <= new Date()) return [400, { message: "link_expired" }];
    const v = tables.estimate_versions.find((x) => x.id === r.version_id);
    const at = new Date().toISOString();
    const s = { id: crypto.randomUUID(), request_id: r.id, estimate_id: r.estimate_id, version_id: r.version_id, user_id: r.user_id, company_id: null, signer_name: a.p_signer_name, signer_email: a.p_signer_email, method: a.p_method, signature_text: a.p_signature_text, signature_image: a.p_signature_image, consent_version: a.p_consent_version, consent_text: a.p_consent_text, acceptance_text: a.p_acceptance_text, consented_at: a.p_consented_at, document_hash: r.document_hash, content_hash: r.content_hash, total: v.total, version_number: v.version_number, proposal_number: v.proposal.meta.number, project_title: v.proposal.meta.title, customer_name: v.proposal.customer.name, verification: "link_possession", ip_address: a.p_ip, user_agent: a.p_user_agent, signed_at: at, pdf_status: "pending", pdf_path: null, pdf_hash: null, pdf_error: null, pdf_attempts: 0 };
    tables.signatures.push(s);
    Object.assign(r, { status: "signed", signed_at: at });
    return [200, [{ signature_id: s.id, created: true, request_id: r.id }]];
  };
  esignRpc.record_signed_pdf = (a) => {
    const s = tables.signatures.find((x) => x.id === a.p_signature_id);
    if (s && s.pdf_status !== "ready") Object.assign(s, a.p_ok ? { pdf_status: "ready", pdf_path: a.p_path, pdf_hash: a.p_hash, pdf_error: null } : { pdf_status: "failed", pdf_error: a.p_error }, { pdf_attempts: s.pdf_attempts + 1 });
    return [200, null];
  };
}
// V4 sales pipeline walk (MOCK_PIPELINE=1, together with MOCK_ESIGN_FIXTURE): bids in every stage, stage history,
// and a set_estimate_stage stand-in that applies the same transition rules as the SQL so moves persist in memory.
const pipelineRpc = {};
if (process.env.MOCK_PIPELINE && ESIGN) {
  const E = (n) => `11111111-1111-4111-8111-11111111111${n}`;
  const P = (n) => `11111111-1111-4111-8111-2222222222${String(n).padStart(2, "0")}`;
  const base = { user_id: USER.id, status: "finalized", lost_reason: null, won_at: null, stage_changed_at: null };
  const set = (id, o) => Object.assign(tables.estimates.find((e) => e.id === id), o);
  set(E(1), { created_at: iso(6), pipeline_stage: "ready_for_review", stage_changed_at: iso(4), won_at: null, lost_reason: null });
  set(E(2), { created_at: iso(14), pipeline_stage: "sent", stage_changed_at: iso(2), won_at: null, lost_reason: null });
  set(E(3), { created_at: iso(9), pipeline_stage: "draft", stage_changed_at: null, won_at: null, lost_reason: null });
  set(E(4), { created_at: iso(35), pipeline_stage: "pending", stage_changed_at: iso(31), won_at: null, lost_reason: null });
  set(E(5), { created_at: iso(12), pipeline_stage: "scheduled", stage_changed_at: iso(3), won_at: iso(5), lost_reason: null });
  const add = (n, title, customer, trades, stage, total, cost, o = {}) => {
    tables.estimates.push({ ...base, id: P(n), title, customer_name: customer, trades, estimate_number: `B-${1100 + n}`, pipeline_stage: stage, created_at: iso(30), updated_at: iso(2), ...o });
    if (total !== null) tables.estimate_versions.push({ id: `44444444-4444-4444-8444-0000000001${String(n).padStart(2, "0")}`, estimate_id: P(n), user_id: USER.id, version_number: 1, total, subtotal: total, total_cost: cost, created_at: iso(10), proposal: {}, snapshot: {}, content_hash: "e".repeat(64) });
  };
  add(1, "Primary bath remodel", "Priya Patel", ["bathroom-remodeling"], "sent", 12400, 8900, { created_at: iso(11), updated_at: iso(5), stage_changed_at: iso(5) });
  add(2, "Seamless gutters", "Tran Nguyen", ["gutters"], "ready_for_review", 3250, 2100, { created_at: iso(3), updated_at: iso(1), stage_changed_at: iso(1) });
  add(3, "Roof replacement", "Dana Brooks", ["roofing"], "won", 22800, 16000, { created_at: iso(24), updated_at: iso(9), stage_changed_at: iso(9), won_at: iso(9) });
  add(4, "Exterior paint", "Jordan Kim", ["painting"], "in_progress", 7900, 5200, { created_at: iso(45), updated_at: iso(1), stage_changed_at: iso(1), won_at: iso(20) });
  add(5, "Window package", "Chris Davis", ["windows"], "completed", 15200, 11300, { created_at: iso(80), updated_at: iso(8), stage_changed_at: iso(8), won_at: iso(40) });
  add(6, "Composite deck", "Riley Wright", ["decks"], "lost", 9600, 6800, { created_at: iso(28), updated_at: iso(7), stage_changed_at: iso(7), lost_reason: "Went with a lower bid" });
  add(7, "Driveway replacement", "Sam Lopez", ["concrete"], "lost", 4100, 2900, { created_at: iso(70), updated_at: iso(50), stage_changed_at: iso(50), lost_reason: "Postponed to next year" });
  add(8, "Siding + trim", "Avery Moore", ["siding"], "sent", 13750, 9900, { created_at: iso(16), updated_at: iso(6), stage_changed_at: iso(6) });
  add(9, "Basement finish (estimating)", "Morgan Reyes", ["basement-finishing"], "draft", null, null, { status: "draft", created_at: iso(1), updated_at: iso(0) });
  const h = (est, from, to, d, note = null) => ({ id: tables.estimate_stage_history?.length ?? 0, estimate_id: est, from_stage: from, to_stage: to, created_at: iso(d), effective_at: iso(d), note, changed_by: USER.id });
  tables.estimate_stage_history = [
    h(E(2), "ready_for_review", "sent", 2), h(E(4), "ready_for_review", "pending", 31), h(E(5), "won", "scheduled", 3),
    h(P(1), "ready_for_review", "sent", 5), h(P(3), "sent", "won", 9, "Approved by phone"), h(P(4), "sent", "won", 20), h(P(4), "scheduled", "in_progress", 1),
    h(P(5), "sent", "won", 40), h(P(5), "in_progress", "completed", 8), h(P(6), "sent", "lost", 7, "Went with a lower bid"), h(P(7), "sent", "lost", 50, "Postponed to next year"),
    h(P(8), "ready_for_review", "sent", 6),
  ];
  const WON = ["won", "scheduled", "in_progress", "completed"];
  pipelineRpc.set_estimate_stage = (a) => {
    const e = tables.estimates.find((x) => x.id === a.p_estimate_id);
    if (!e) return [400, { code: "P0002", message: "estimate_not_found" }];
    const signed = (tables.signatures ?? []).some((s) => s.estimate_id === e.id);
    if (signed && ["draft", "ready_for_review", "approved", "sent", "pending"].includes(a.p_stage)) return [400, { code: "42501", message: "bid_signed" }];
    if (["scheduled", "in_progress", "completed"].includes(a.p_stage) && !(WON.includes(e.pipeline_stage) || signed)) return [400, { code: "42501", message: "not_won" }];
    const at = a.p_effective_at ?? new Date().toISOString();
    tables.estimate_stage_history.push({ id: tables.estimate_stage_history.length, estimate_id: e.id, from_stage: e.pipeline_stage, to_stage: a.p_stage, created_at: new Date().toISOString(), effective_at: at, note: a.p_note, changed_by: USER.id });
    const wasWon = WON.includes(e.pipeline_stage);
    Object.assign(e, {
      pipeline_stage: a.p_stage, stage_changed_at: new Date().toISOString(), lost_reason: a.p_stage === "lost" ? a.p_note : null,
      won_at: a.p_stage === "won" && (a.p_effective_at || !wasWon) ? at : WON.includes(a.p_stage) ? e.won_at ?? at : null,
    });
    pipelineRpc.calls.push(a);
    return [200, null];
  };
  pipelineRpc.calls = [];
}
const COMP_RPC = /^(admin_comp_\w+|my_comp_access|claim_comp_grant_by_token|has_paid_subscription|credit_status|library_access)$/;
const compPool = process.env.COMP_PG_URL ? new (await import("pg")).default.Pool({ connectionString: process.env.COMP_PG_URL, max: 5 }) : null;
const inviteLog = [];
async function compRpc(name, args, res) {
  const keys = Object.keys(args);
  const params = keys.map((k) => (args[k] !== null && typeof args[k] === "object" ? JSON.stringify(args[k]) : args[k]));
  const call = `public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")})`;
  const setReturning = ["my_comp_access", "credit_status"].includes(name);
  const c = await compPool.connect();
  try {
    await c.query("begin");
    // Functions that read auth.uid() run as the signed-in mock user.
    await c.query("select set_config('request.jwt.claim.sub', $1, true)", [USER.id]);
    const r = await c.query(setReturning ? `select * from ${call}` : `select ${call} as v`, params);
    await c.query("commit");
    send(res, 200, setReturning ? r.rows : r.rows[0].v);
  } catch (e) {
    await c.query("rollback").catch(() => {});
    send(res, 400, { code: e.code ?? "P0001", message: e.message, details: null, hint: null });
  } finally { c.release(); }
}

let onboardingMode = "ok";
let activationSeed = null;
http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  let raw = ""; const bufs = []; req.on("data", (c) => bufs.push(c));
  req.on("end", () => {
    const bodyBuf = Buffer.concat(bufs); raw = bodyBuf.toString("utf8");
    if (req.method === "OPTIONS") return send(res, 204);
    if (u.pathname === "/__scenario") {
      authDelayMs = Number(u.searchParams.get("authDelayMs") ?? 0);
      return applyScenario(u.searchParams.get("name") ?? "") ? send(res, 200, { ok: true }) : send(res, 400, { error: "unknown scenario" });
    }
    // Welcome popup tests: set the account's profiles.onboarding_status ("new" = null, "missing" = column not migrated).
    if (u.pathname === "/__onboarding") {
      const st = u.searchParams.get("status");
      if (st) { onboardingMode = st === "missing" ? "missing" : "ok"; tables.profiles[0].onboarding_status = ["existing", "dismissed", "completed"].includes(st) ? st : null; }
      return send(res, 200, { mode: onboardingMode, status: tables.profiles[0].onboarding_status ?? null });
    }
    if (u.pathname === "/rest/v1/profiles" && onboardingMode === "missing" && ((u.searchParams.get("select") ?? "").includes("onboarding") || raw.includes("onboarding"))) {
      return send(res, 400, { code: "42703", message: "column profiles.onboarding_status does not exist" });
    }
    if (u.pathname === "/rest/v1/profiles" && req.method === "PATCH") {
      let body = {}; try { body = JSON.parse(raw || "{}"); } catch { /* ignore */ }
      const p = tables.profiles[0];
      const onlyNull = u.searchParams.get("onboarding_status") === "is.null";
      if (!(onlyNull && p.onboarding_status)) Object.assign(p, body);
      return send(res, 200, [p]);
    }
    // Project scheduling: GET /__pm?state=<json for my_pm_access>. company_pm_assign toggles tables.pm_editors.
    if (u.pathname === "/__pm") { tables.pm_editors ??= []; rpcs.my_pm_access = u.searchParams.get("state") ? JSON.parse(u.searchParams.get("state")) : null; return send(res, 200, { ok: true }); }
    // Phase 9 seat overview and reassignment, from tables.pm_editors (order = rank).
    if (u.pathname === "/rest/v1/rpc/company_pm_seats") {
      const pm = rpcs.my_pm_access ?? { editorLimit: 0 };
      tables.pm_editors ??= [];
      return send(res, 200, { limit: pm.editorLimit, source: "stripe", paid: true, extraPaid: Math.max(0, pm.editorLimit - 1),
        seats: tables.pm_editors.map((e, i) => ({ userId: e.user_id, rank: i + 1, seatType: i + 1 > pm.editorLimit ? "uncovered" : i === 0 ? "included" : "paid", covered: i + 1 <= pm.editorLimit,
          assignedAt: e.assigned_at ?? iso(10), changedAt: e.changed_at ?? e.assigned_at ?? iso(10), changedBy: e.changed_by ?? USER.id })),
        schedules: Object.fromEntries(tables.pm_editors.map((e) => [e.user_id, 2])) });
    }
    if (u.pathname === "/rest/v1/rpc/company_pm_reassign") {
      let a = {}; try { a = JSON.parse(raw || "{}"); } catch { /* ignore */ }
      tables.pm_editors ??= [];
      const seat = tables.pm_editors.find((e) => e.user_id === a.p_from);
      if (!seat) return send(res, 400, { code: "P0002", message: "not_editor" });
      if (tables.pm_editors.some((e) => e.user_id === a.p_to)) return send(res, 400, { code: "23505", message: "already_editor" });
      Object.assign(seat, { user_id: a.p_to, changed_at: new Date().toISOString(), changed_by: USER.id });
      return send(res, 200, { ok: true });
    }
    if (u.pathname === "/rest/v1/rpc/company_pm_assign") {
      let a = {}; try { a = JSON.parse(raw || "{}"); } catch { /* ignore */ }
      tables.pm_editors ??= [];
      const pm = rpcs.my_pm_access ?? { editorLimit: 0, editorsAssigned: 0 };
      const has = tables.pm_editors.some((e) => e.user_id === a.p_user_id);
      if (a.p_assign && !has) {
        if (tables.pm_editors.length >= pm.editorLimit) return send(res, 400, { code: "P0001", message: "editor_limit" });
        tables.pm_editors.push({ user_id: a.p_user_id, assigned_at: new Date().toISOString() });
      } else if (!a.p_assign) tables.pm_editors = tables.pm_editors.filter((e) => e.user_id !== a.p_user_id);
      rpcs.my_pm_access = { ...pm, editorsAssigned: tables.pm_editors.length };
      return send(res, 200, { ok: true, changed: true });
    }
    // Feature discovery state (auth user_metadata.b2b_features): reset, or set created_at for "new account" checks.
    if (u.pathname === "/__features") { USER.user_metadata = {}; if (u.searchParams.get("created")) USER.created_at = u.searchParams.get("created"); return send(res, 200, { ok: true }); }
    // Growth activation walk: "new" = account with no bids or company; "partial" = one priced draft, nothing exported yet.
    if (u.pathname === "/__activation") {
      const st = u.searchParams.get("state");
      activationSeed ??= JSON.stringify({ estimates: tables.estimates, estimate_versions: tables.estimate_versions, business_profiles: tables.business_profiles });
      Object.assign(tables, JSON.parse(activationSeed));
      if (st === "new") { tables.estimates = []; tables.estimate_versions = []; tables.business_profiles = []; }
      if (st === "partial") { tables.estimates = tables.estimates.slice(0, 1); tables.estimate_versions = []; }
      return send(res, 200, { ok: true, estimates: tables.estimates.length });
    }
    if (u.pathname === "/__reset_library") { Object.assign(tables, JSON.parse(LIBRARY_SEED)); return send(res, 200, { ok: true }); }
    if (u.pathname === "/auth/v1/user" && req.method === "GET") return void setTimeout(() => send(res, 200, USER), authDelayMs);
    if (u.pathname === "/__otp-log") {
      if (u.searchParams.get("reset")) otpLog.length = 0;
      return send(res, 200, otpLog);
    }
    // Email/SMS OTP for checkout and sign-in tests: code 123456 (or 012345) succeeds, anything else is "expired or invalid".
    // SMS: numbers in KNOWN_PHONES have accounts; others get Supabase's "Signups not allowed" unless create_user is set.
    // Email with create_user=false (linking a phone to an existing account): only USER.email exists.
    if (u.pathname === "/auth/v1/otp") {
      let body = {}; try { body = JSON.parse(raw || "{}"); } catch { /* ignore */ }
      otpLog.push({ kind: "otp", phone: body.phone, email: body.email, create_user: body.create_user, channel: body.channel });
      const exists = body.phone ? KNOWN_PHONES.has(String(body.phone).replace(/\D/g, "")) : (body.email ?? "").toLowerCase() === USER.email;
      if (body.create_user === false && !exists) return send(res, 422, { code: 422, error_code: "otp_disabled", msg: "Signups not allowed for otp" });
      return send(res, 200, {});
    }
    if (u.pathname === "/auth/v1/user" && req.method === "PUT") {
      let body = {}; try { body = JSON.parse(raw || "{}"); } catch { /* ignore */ }
      otpLog.push({ kind: "update_user", phone: body.phone, email: body.email });
      if (body.data && typeof body.data === "object") USER.user_metadata = { ...USER.user_metadata, ...body.data };
      if (body.phone && String(body.phone).replace(/\D/g, "") === TAKEN_PHONE) return send(res, 422, { code: 422, error_code: "phone_exists", msg: "A user with this phone number has already been registered" });
      return send(res, 200, { ...USER, new_phone: body.phone, new_email: body.email });
    }
    if (u.pathname === "/auth/v1/verify") {
      let body = {}; try { body = JSON.parse(raw || "{}"); } catch { /* ignore */ }
      // "012345" also works, to prove leading zeros reach Supabase intact.
      if (body.token !== "123456" && body.token !== "012345") return send(res, 403, { code: "otp_expired", error_code: "otp_expired", msg: "Token has expired or is invalid" });
      otpLog.push({ kind: "verify", type: body.type, phone: body.phone, email: body.email });
      const b64u = (x) => Buffer.from(x).toString("base64url");
      const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: USER.id, exp: 4102444800, role: "authenticated", aud: "authenticated", email: body.email }))}.sig`;
      return send(res, 200, { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600 * 24 * 365, expires_at: 4102444800, user: { ...USER, email: body.email ?? USER.email, ...(body.phone ? { phone: String(body.phone).replace(/\D/g, ""), phone_confirmed_at: new Date().toISOString() } : {}) } });
    }
    if (u.pathname === "/auth/v1/invite") { try { inviteLog.push({ ...JSON.parse(raw || "{}"), redirect_to: u.searchParams.get("redirect_to") }); } catch { /* ignore */ } return send(res, 200, { id: crypto.randomUUID(), email: inviteLog.at(-1)?.email }); }
    if (u.pathname === "/__invites") return send(res, 200, inviteLog);
    if (u.pathname === "/auth/v1/admin/users" && req.method === "GET" && authAdminUsers) return send(res, 200, { users: authAdminUsers, aud: "authenticated" }, { "x-total-count": String(authAdminUsers.length) });
    if (u.pathname.startsWith("/auth/v1/")) return send(res, 200, {});
    if (ESIGN && u.pathname.startsWith("/storage/v1/object/")) {
      const signedM = u.pathname.match(/^\/storage\/v1\/object\/sign\/(.+)$/);
      if (signedM && req.method === "POST") return storage.has(signedM[1]) ? send(res, 200, { signedURL: `/object/sign/${signedM[1]}?token=mock` }) : send(res, 400, { statusCode: "404", error: "not_found", message: "Object not found" });
      const key = decodeURIComponent(u.pathname.replace(/^\/storage\/v1\/object\/(authenticated\/|sign\/)?/, ""));
      if (req.method === "POST" || req.method === "PUT") {
        storage.set(key, bodyBuf);
        return send(res, 200, { Key: key });
      }
      if (req.method === "GET") {
        const b = storage.get(key);
        if (!b) return send(res, 400, { statusCode: "404", error: "not_found", message: "Object not found" });
        res.writeHead(200, { "content-type": "application/pdf" }); return void res.end(b);
      }
    }
    if (u.pathname.startsWith("/storage/v1/")) return send(res, 400, { error: "not available in mock" });
    // Opportunity Radar walk (scripts/radar/walk.mjs): radar_* tables and RPCs run real SQL when RADAR_PG_URL is set.
    if (radarRestEnabled() && /^\/rest\/v1\/(rpc\/)?radar_/.test(u.pathname)) return void handleRadarRest(req, res, u, raw, send);
    const rpc = u.pathname.match(/^\/rest\/v1\/rpc\/(\w+)/);
    if (u.pathname === "/__pipeline_calls") return send(res, 200, pipelineRpc.calls ?? []);
    if (rpc && typeof pipelineRpc[rpc[1]] === "function") { let args = {}; try { args = JSON.parse(raw || "{}"); } catch { /* ignore */ } const [st, body] = pipelineRpc[rpc[1]](args); return send(res, st, body); }
    if (u.pathname === "/__ws") { if (u.searchParams.get("seed")) seedWorkspace(); return send(res, 200, { ok: true, count: sched.list.size }); }
    if (u.pathname === "/__team") {
      if (u.searchParams.get("reset")) team.list = [];
      if (u.searchParams.get("seed")) seedTeam();
      if (u.searchParams.get("manage")) team.canManage = u.searchParams.get("manage") === "1";
      return send(res, 200, { ok: true, count: team.list.length });
    }
    if (u.pathname === "/__sched") {
      if (u.searchParams.get("reset")) { sched.list.clear(); tables.project_schedules = []; tables.schedule_publications = []; }
      const st = u.searchParams.get("stage"); if (st) tables.estimates[0].pipeline_stage = st;
      return send(res, 200, { ok: true, schedules: [...sched.list.keys()] });
    }
    if (rpc && scheduleRpc[rpc[1]]) { let args = {}; try { args = JSON.parse(raw || "{}"); } catch { /* ignore */ } const [st, body] = scheduleRpc[rpc[1]](args); return send(res, st, body); }
    if (rpc && esignRpc[rpc[1]]) { let args = {}; try { args = JSON.parse(raw || "{}"); } catch { /* ignore */ } const [st, body] = esignRpc[rpc[1]](args); return send(res, st, body); }
    if (rpc && compPool && COMP_RPC.test(rpc[1])) { let args = {}; try { args = JSON.parse(raw || "{}"); } catch { /* ignore */ } return void compRpc(rpc[1], args, res); }
    if (rpc) return send(res, 200, rpcs[rpc[1]] ?? null);
    const t = u.pathname.match(/^\/rest\/v1\/(\w+)/);
    if (!t) return send(res, 404, { message: "unknown" });
    const matches = (r) => [...u.searchParams].every(([k, v]) => {
      if (v.startsWith("in.") && r[k] !== undefined) return v.slice(4, -1).split(",").map((x) => x.replace(/^"|"$/g, "")).includes(String(r[k]));
      if (v.startsWith("neq.") && r[k] !== undefined) return String(r[k]) !== v.slice(4);
      return !v.startsWith("eq.") || r[k] === undefined || String(r[k]) === v.slice(3);
    });
    // Library tables keep writes in memory so saved items can be created, edited and deleted in browser walks.
    const LIVE = new Set(["saved_items", "assemblies", "assembly_items", "schedule_publications"]);
    if (req.method !== "GET" && req.method !== "HEAD") {
      if (!LIVE.has(t[1])) return send(res, 201, []);
      const list = (tables[t[1]] ??= []);
      let body = null; try { body = JSON.parse(raw || "null"); } catch { /* ignore */ }
      if (req.method === "POST") {
        const add = (Array.isArray(body) ? body : [body]).filter(Boolean).map((r) => ({ id: r.id ?? crypto.randomUUID(), created_at: iso(0), ...r }));
        if (t[1] === "saved_items" && !rpcs.library_access) return send(res, 403, { code: "42501", message: 'new row violates row-level security policy for table "saved_items"' });
        list.push(...add);
        return send(res, 201, add);
      }
      if (req.method === "PATCH") {
        const hit = rpcs.library_access ? list.filter(matches) : [];
        for (const r of hit) Object.assign(r, body);
        return send(res, 200, hit);
      }
      if (req.method === "DELETE") {
        const keep = list.filter((r) => !matches(r));
        const gone = list.length - keep.length;
        tables[t[1]] = keep;
        if (t[1] === "assemblies") tables.assembly_items = (tables.assembly_items ?? []).filter((i) => keep.some((a) => a.id === i.assembly_id));
        return send(res, 200, gone ? [] : []);
      }
      return send(res, 201, []);
    }
    let rows = (tables[t[1]] ?? []).filter(matches);
    const one = (req.headers.accept ?? "").includes("vnd.pgrst.object");
    if (one) return rows.length ? send(res, 200, rows[0]) : send(res, 406, { code: "PGRST116", details: "The result contains 0 rows", hint: null, message: "JSON object requested, multiple (or no) rows returned" });
    send(res, 200, rows, { "content-range": `0-${Math.max(rows.length - 1, 0)}/${rows.length}` });
  });
}).listen(PORT, () => console.log(`mock supabase on ${PORT}`));
