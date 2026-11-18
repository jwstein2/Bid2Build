// Contractors & Workforce V7.3 mock RPCs for browser walks (scripts/workforce/walk.mjs). Test data only.
// The real rules live in SQL (supabase/migrations/20270102005000_workforce_directory.sql) and are tested in
// tests/db/workforce.test.ts; this mirrors them closely enough to drive the UI.
export function installWorkforce({ scheduleRpc, team, sched, schedPerms, taskRow, iso, USER, tables }) {
  const events = [];
  const res = (id) => team.list.find((r) => r.id === id);
  const mode = (r) => (r.kind === "crew" ? "crew" : r.kind === "staff" || r.entity === "individual" ? "person" : "company");
  const allTasks = () => [...sched.list.values()].flatMap((s) => s.tasks.map((t) => ({ t, s })));
  const live = (t) => t.status !== "complete" && !["declined", "cancelled"].includes(t.assignment_status ?? "");
  const tOverlap = (a, s, e) => !(s && e && a.assignment_start_time && a.assignment_end_time && (a.assignment_end_time <= s || a.assignment_start_time >= e));
  function conflicts(r, sid, tid, from, to, st, et) {
    const out = [];
    const unav = (r.unavailable ?? []).filter((d) => d >= from && d <= to);
    if (unav.length) out.push({ kind: "unavailable", resourceId: r.id, resource: r.name, days: unav, tasks: [] });
    const others = allTasks().filter(({ t, s }) => s.row.id !== sid && t.id !== tid && live(t) && t.planned_start <= to && t.planned_end >= from && !s.tasks.some((c) => c.parent_id === t.id && c.resource_id === t.resource_id));
    const m = mode(r);
    if (m === "person") {
      const crews = team.list.filter((c) => c.kind === "crew" && (c.members ?? []).includes(r.id)).map((c) => c.id);
      const hit = others.filter(({ t }) => (t.resource_id === r.id || crews.includes(t.resource_id)) && tOverlap(t, st, et));
      if (hit.length) out.push({ kind: "double_booked", resourceId: r.id, resource: r.name, tasks: hit.map(({ t, s }) => ({ taskId: t.id, scheduleId: s.row.id, project: s.row.name, task: t.name, start: t.planned_start, end: t.planned_end, via: t.resource_id === r.id ? null : res(t.resource_id)?.name ?? null })) });
    } else if (m === "crew") {
      const jobs = new Set(others.filter(({ t }) => t.resource_id === r.id).map(({ s }) => s.row.id)).size;
      if (jobs >= Math.max(1, r.capacity ?? 1)) out.push({ kind: "over_capacity", resourceId: r.id, resource: r.name, jobs, capacity: r.capacity ?? 1, tasks: [] });
      for (const mid of r.members ?? []) { const mm = res(mid); if (mm) out.push(...conflicts(mm, sid, tid, from, to, st, et).filter((c) => c.kind === "double_booked")); }
    } else {
      const workers = team.list.filter((w) => w.parentId === r.id).map((w) => w.id);
      const jobs = new Set(others.filter(({ t }) => t.resource_id === r.id || workers.includes(t.resource_id)).map(({ s }) => s.row.id)).size;
      if (r.capacityDeclared && jobs >= (r.capacity ?? 1)) out.push({ kind: "possible_overbooking", resourceId: r.id, resource: r.name, jobs, capacity: r.capacity, tasks: [] });
      else if (!r.capacityDeclared && jobs > 0) out.push({ kind: "capacity_unknown", resourceId: r.id, resource: r.name, jobs, tasks: [] });
    }
    return out;
  }
  const trade = (s, t) => s.snapshot.sections.find((g) => g.id === t.source_group_id)?.trade ?? null;
  Object.assign(scheduleRpc, {
    pm_resource_save: ({ p }) => {
      if (!team.canManage || !schedPerms().edit) return [403, { code: "42501", message: "forbidden" }];
      if (!p?.name?.trim()) return [400, { code: "22023", message: "name_required" }];
      const trades = [...new Set((p.trades ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean))];
      const old = p.id ? res(p.id) : null;
      if (p.id && !old) return [404, { code: "42501", message: "not_found" }];
      const kind = old?.kind ?? p.kind;
      const parentId = kind === "subcontractor" ? ("parentId" in p ? p.parentId ?? null : old?.parentId ?? null) : null;
      if (parentId && (!res(parentId) || res(parentId).entity === "individual" || res(parentId).parentId)) return [400, { code: "22023", message: "bad_parent" }];
      const fields = { kind, name: p.name.trim(), contactName: p.contactName ?? null, linkedUserId: kind === "staff" ? p.linkedUserId ?? null : null, trades, email: p.email ?? null,
        phone: p.phone ?? null, notes: p.notes ?? null, capacity: p.capacity ?? 1, unavailable: p.unavailable ?? [], specialties: p.specialties ?? old?.specialties ?? [],
        entity: kind === "subcontractor" ? (parentId ? "individual" : "entity" in p ? p.entity ?? null : old?.entity ?? null) : null, parentId,
        crewSize: "crewSize" in p ? p.crewSize ?? null : old?.crewSize ?? null,
        capacityDeclared: "capacityDeclared" in p ? !!p.capacityDeclared : old?.capacityDeclared ?? (kind === "crew" || (p.capacity ?? 1) > 1),
        ...(kind === "crew" ? { members: p.members ?? old?.members ?? [] } : {}) };
      if (old) { Object.assign(old, fields); return [200, old.id]; }
      const r = { id: crypto.randomUUID(), status: "active", members: [], createdAt: iso(0), ...fields };
      team.list.push(r);
      return [200, r.id];
    },
    pm_workforce: () => {
      const assignments = allTasks().filter(({ t, s }) => t.resource_id && s.row.status !== "archived" && !(t.assignment_inherited && s.tasks.some((p) => p.id === t.parent_id && p.resource_id === t.resource_id)))
        .map(({ t, s }) => ({ taskId: t.id, scheduleId: s.row.id, parentId: t.parent_id, kind: t.kind, task: t.name, start: t.planned_start, end: t.planned_end, taskStatus: t.status, percent: t.percent_complete,
          resourceId: t.resource_id, status: t.assignment_status ?? null, inherited: !!t.assignment_inherited, notes: t.assignment_notes ?? null, hours: t.assignment_hours ?? null,
          startTime: t.assignment_start_time ?? null, endTime: t.assignment_end_time ?? null, project: s.row.name, projectStatus: s.row.status, customer: s.snapshot.estimate.customerName, trade: trade(s, t), revision: s.row.revision }));
      const manage = team.canManage && schedPerms().edit;
      return [200, { companyId: "c0000000-0000-4000-8000-000000000001", me: USER.id, canManage: manage,
        resources: team.list.map((r) => {
          const hide = r.kind === "staff" && !manage && r.linkedUserId !== USER.id;
          return { capacityDeclared: false, specialties: [], entity: null, parentId: null, crewSize: null, ...r, email: hide ? null : r.email, phone: hide ? null : r.phone, contactHidden: hide && !!(r.email || r.phone), notes: manage ? r.notes : null };
        }), assignments }];
    },
    pm_assign_targets: () => [200, [...sched.list.values()].filter((s) => ["draft", "active"].includes(s.row.status)).map((s) => ({ id: s.row.id, name: s.row.name, status: s.row.status, revision: s.row.revision,
      startDate: s.row.start_date, customer: s.snapshot.estimate.customerName, canEdit: schedPerms().edit,
      tasks: s.tasks.map((t) => ({ id: t.id, parentId: t.parent_id, kind: t.kind, name: t.name, start: t.planned_start, end: t.planned_end, status: t.status, resourceId: t.resource_id ?? null, assignee: t.assignee, assignmentStatus: t.assignment_status ?? null, inherited: !!t.assignment_inherited, trade: trade(s, t) })) }))],
    pm_assign_resource: ({ p }) => {
      const found = allTasks().find(({ t }) => t.id === p.taskId);
      if (!found) return [400, { code: "22023", message: "bad_task" }];
      const { t, s } = found;
      if (!schedPerms().edit) return [403, { code: "42501", message: "forbidden" }];
      if (p.baseRevision !== undefined && p.baseRevision !== s.row.revision) return [409, { code: "40001", message: "stale_revision", details: String(s.row.revision) }];
      const r = res(p.resourceId);
      if (!r || r.status !== "active") return [400, { code: "22023", message: "bad_resource" }];
      const status = p.status ?? "tentative";
      const same = s.tasks.filter((x) => x.id !== t.id && x.resource_id === r.id && !["declined", "cancelled"].includes(x.assignment_status ?? "") && x.parent_id !== t.id && t.parent_id !== x.id && x.planned_start <= t.planned_end && x.planned_end >= t.planned_start)
        .map((x) => ({ taskId: x.id, task: x.name, start: x.planned_start, end: x.planned_end }));
      const conf = ["declined", "cancelled"].includes(status) ? [] : conflicts(r, s.row.id, t.id, t.planned_start, t.planned_end, p.startTime, p.endTime);
      const hard = conf.filter((c) => c.kind !== "capacity_unknown");
      const canOverride = process.env.WF_NO_OVERRIDE !== "1";
      if (p.dryRun) return [200, { ok: true, dryRun: true, conflicts: conf, alreadyOnProject: same, needsOverride: hard.length > 0, canOverride, revision: s.row.revision }];
      if (same.length && !p.allowSameProject) return [200, { ok: false, alreadyOnProject: same, conflicts: conf, revision: s.row.revision }];
      if (hard.length && !p.overrideReason) return [200, { ok: false, needsOverride: true, canOverride, conflicts: conf, revision: s.row.revision }];
      const prev = t.resource_id;
      Object.assign(t, { resource_id: r.id, assignee: r.name, assignment_status: status, assignment_inherited: false, assignment_notes: p.notes ?? null, assignment_hours: p.hours ?? null,
        assignment_start_time: p.startTime ?? null, assignment_end_time: p.endTime ?? null });
      if (t.kind === "section") for (const c of s.tasks.filter((x) => x.parent_id === t.id && (x.assignment_inherited || (!x.resource_id && !x.assignee)))) Object.assign(c, { resource_id: r.id, assignee: r.name, assignment_status: status, assignment_inherited: true });
      s.row.revision += 1; s.row.updated_at = iso(0);
      s.revisions.push({ revision: s.row.revision, summary: `${r.name} assigned to ${t.name} (Contractors & Workforce)`, created_at: iso(0), actor_id: USER.id, changes: [] });
      events.unshift({ id: events.length + 1, action: prev ? (prev === r.id ? "details" : "reassigned") : "assigned", status, task: t.name, scheduleId: s.row.id, project: s.row.name, resourceId: r.id,
        previousResourceId: prev && prev !== r.id ? prev : null, source: "directory", overrideReason: hard.length ? p.overrideReason : null, actorId: USER.id, at: iso(0) });
      return [200, { ok: true, revision: s.row.revision, conflicts: conf, overridden: hard.length > 0 }];
    },
    pm_resource_history: ({ p_resource }) => {
      const workers = team.list.filter((w) => w.parentId === p_resource).map((w) => w.id);
      return [200, events.filter((e) => e.resourceId === p_resource || e.previousResourceId === p_resource || workers.includes(e.resourceId))];
    },
  });

  /** Red's Electric with four electricians, a concrete crew, painters, employees, five projects and one real conflict. */
  function seed() {
    team.list = [];
    const add = (o) => { const r = { id: crypto.randomUUID(), status: "active", contactName: null, linkedUserId: null, trades: [], specialties: [], email: null, phone: null, notes: null, capacity: 1, capacityDeclared: false, unavailable: [], members: [], entity: null, parentId: null, crewSize: null, createdAt: iso(30), ...o }; team.list.push(r); return r; };
    const reds = add({ kind: "subcontractor", entity: "company", name: "Red's Electric", contactName: "Red Alvarez", trades: ["electrical", "low voltage"], specialties: ["Panel upgrades", "EV chargers"], email: "office@redselectric.example.com", phone: "555-0140", crewSize: 4 });
    const ea = add({ kind: "subcontractor", parentId: reds.id, entity: "individual", name: "Marco Diaz", trades: ["electrical"], phone: "555-0141" });
    add({ kind: "subcontractor", parentId: reds.id, entity: "individual", name: "Tia Brooks", trades: ["electrical"], phone: "555-0142" });
    add({ kind: "subcontractor", parentId: reds.id, entity: "individual", name: "Sam Okafor", trades: ["electrical", "low voltage"] });
    add({ kind: "subcontractor", parentId: reds.id, entity: "individual", name: "Lena Park", trades: ["electrical"] });
    const bright = add({ kind: "subcontractor", entity: "company", name: "Bright Coat Painting", contactName: "Dee Hart", trades: ["painting"], specialties: ["Exterior repaint", "Cabinet finishing"], phone: "555-0150", capacity: 2, capacityDeclared: true, crewSize: 6 });
    const kim = add({ kind: "subcontractor", entity: "individual", name: "Kim Nguyen", trades: ["painting", "drywall"], phone: "555-0151", unavailable: [] });
    const alex = add({ kind: "staff", name: "Alex Rivera", linkedUserId: USER.id, trades: ["general"], phone: "555-0101", email: "alex@built2bid.test" });
    const jose = add({ kind: "staff", name: "Jose Martinez", trades: ["concrete", "demolition"], phone: "555-0102", email: "jose@home.example.com" });
    const crew = add({ kind: "crew", name: "Flatwork Crew A", trades: ["concrete"], members: [jose.id], capacity: 1, capacityDeclared: true, crewSize: 3 });
    add({ kind: "subcontractor", name: "Peak Roofing", contactName: "Dana", trades: ["roofing"], phone: "555-0120" }); // saved before V7.3: no entity
    const day = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
    sched.list.clear();
    const jobs = [
      { name: "Maple St Kitchen", customer: "Garcia", trade: "electrical", secs: [["Electrical rough-in", -1, 3, ea, "confirmed"], ["Painting", 6, 2, kim, "tentative"]] },
      { name: "Oak Ave Addition", customer: "Nguyen", trade: "electrical", secs: [["Electrical service", 1, 2, ea, "tentative"], ["Concrete footings", 4, 2, crew, "confirmed"]] },
      { name: "Pine Rd Basement", customer: "Smith", trade: "painting", secs: [["Drywall & paint", 3, 4, bright, "confirmed"], ["Electrical trim", 9, 1, null, null]] },
      { name: "Birch Ln Patio", customer: "Lopez", trade: "concrete", secs: [["Patio pour", 4, 1, jose, "requested"], ["Lighting", 12, 1, null, null]] },
      { name: "Cedar Ct Repaint", customer: "Okoro", trade: "painting", secs: [["Exterior paint", -12, 3, bright, "confirmed", "complete"]] },
    ];
    for (const j of jobs) {
      const id = crypto.randomUUID();
      const tasks = j.secs.map(([n, start, dur, who, st, done], i) => taskRow({ id: crypto.randomUUID(), kind: "section", sourceGroupId: crypto.randomUUID(), name: n, sortOrder: i, plannedStart: day(start), plannedEnd: day(start + dur - 1), durationDays: dur,
        assignee: who?.name ?? null, status: done === "complete" ? "complete" : "not_started", percentComplete: done === "complete" ? 100 : 0, actualFinish: done === "complete" ? day(start + dur - 1) : null }));
      j.secs.forEach(([, , , who, st], i) => { if (who) Object.assign(tasks[i], { resource_id: who.id, assignment_status: st, assignment_inherited: false }); });
      const status = j.secs.some((x) => x[5] === "complete") ? "completed" : "active";
      sched.list.set(id, { row: { id, estimate_id: crypto.randomUUID(), user_id: USER.id, company_id: "c0000000-0000-4000-8000-000000000001", name: j.name, status, provisional: false,
        calendar: { workdays: [1, 2, 3, 4, 5], holidays: [], timezone: "America/Chicago" }, start_date: tasks[0].planned_start, target_end_date: null, progress_method: "duration", revision: 1, updated_at: iso(0),
        sales_rep_id: USER.id, project_manager_id: null },
        snapshot: { estimate: { id, title: j.name, number: "B-3001", customerName: j.customer, projectAddress: null }, trades: [j.trade], version: null,
          sections: tasks.map((t, i) => ({ id: t.source_group_id, name: t.name, trade: /paint/i.test(j.secs[i][0]) ? "painting" : /concrete|patio/i.test(j.secs[i][0]) ? "concrete" : /electric|lighting/i.test(j.secs[i][0]) ? "electrical" : j.trade, sortOrder: i, items: [] })) },
        tasks, deps: [], revisions: [{ revision: 1, summary: "Schedule created", created_at: iso(2), actor_id: USER.id, changes: [] }] });
    }
    tables.project_schedules = [...sched.list.values()].map((x) => x.row);
    events.length = 0;
    void alex;
  }
  return { seed };
}
