// V4.3 Project Operations + V4.4 Bid Style stand-ins for the UX mock (test data only, NOT production).
// Real SQL behavior is covered by tests/db/project-operations.test.ts; this only has to look like it.
const NOW = Date.now();
const iso = (d = 0) => new Date(NOW - d * 864e5).toISOString();
const U = "00000000-0000-4000-8000-000000000001";
const EST = "11111111-1111-4111-8111-111111111111";
const item = (n) => `33333333-3333-4333-8333-0000000000${String(n).padStart(2, "0")}`;
const G = (n) => `22222222-2222-4222-8222-00000000000${n}`;
const V1 = "44444444-4444-4444-8444-0000000000a1", V2 = "44444444-4444-4444-8444-0000000000a2";

export const ops = {
  styleManaged: true, allow: false, canOverride: true,
  scope: [], photos: [], shares: [],
};

const rev = (id, n, amount, note, d) => ({ id, revision: n, amount, quoteDate: iso(d).slice(0, 10), note, documentPath: n === 1 ? "x/quote.pdf" : null, documentName: n === 1 ? "ABC quote.pdf" : null, createdAt: iso(d), createdBy: U });
const recorded = [];
const quotes = () => [
  { id: "88888888-8888-4888-8888-000000000001", itemId: item(3), groupId: G(2), itemName: "Vinyl siding panels", resourceId: "r-abc", vendorName: "ABC Supply", estimatedCost: 2900, status: "under_review", internalNotes: "Price increase on Dutch lap", appliedRevisionId: null, createdAt: iso(6),
    revisions: [rev("88888888-8888-4888-8888-0000000000a1", 1, 2900, "Original quote", 6), rev("88888888-8888-4888-8888-0000000000a2", 2, 3150, "Revised: mill price increase", 1)] },
  { id: "88888888-8888-4888-8888-000000000002", itemId: item(4), groupId: G(2), itemName: "Siding install labor", resourceId: "r-crew", vendorName: "Crew A Installers", estimatedCost: 2400, status: "accepted", internalNotes: null, appliedRevisionId: "88888888-8888-4888-8888-0000000000b1", createdAt: iso(5),
    revisions: [rev("88888888-8888-4888-8888-0000000000b1", 1, 2250, "Fixed bid", 5)] },
];

export function seedOps(team = []) {
  const crew = team.find((r) => r.kind === "crew")?.id ?? "r-crew";
  ops.scope = [
    { id: "77777777-7777-4777-8777-000000000001", estimate_id: EST, source_group_id: G(1), trade: "siding", title: "Siding: Tear-off & prep", sort_order: 0, approved_scope: "• Remove existing siding\n• House wrap", work_description: "Strip all four elevations to sheathing; replace damaged sheathing as found.", technical_instructions: "Tyvek HomeWrap, cap nails 12\" o.c.", installation_notes: null, internal_notes: "Customer is picky about the flower beds.", customer_info: "Dog in the backyard; use the side gate.", resource_id: crew, revision: 3, updated_at: iso(1), updated_by: U },
    { id: "77777777-7777-4777-8777-000000000002", estimate_id: EST, source_group_id: G(2), trade: "siding", title: "Siding: Siding installation", sort_order: 1, approved_scope: "• Vinyl siding panels\n• Siding install labor", work_description: "Install Dutch lap vinyl, color Sandstone.", technical_instructions: null, installation_notes: "Start at the north elevation.", internal_notes: null, customer_info: null, resource_id: null, revision: 1, updated_at: iso(2), updated_by: U },
    { id: "77777777-7777-4777-8777-000000000003", estimate_id: EST, source_group_id: G(3), trade: "siding", title: "Siding: Trim & accessories", sort_order: 2, approved_scope: "• J-channel", work_description: null, technical_instructions: null, installation_notes: null, internal_notes: null, customer_info: null, resource_id: null, revision: 1, updated_at: iso(2), updated_by: U },
  ];
  ops.shares = [{ id: "77777777-7777-4777-8777-0000000000f1", sectionId: "77777777-7777-4777-8777-000000000001", resourceId: crew, createdAt: iso(1), expiresAt: iso(-59), revokedAt: null, version: 1, sectionRevision: 2, sharedAt: iso(1), fields: ["workDescription", "technicalInstructions"], photoCount: 0 }];
  const labels = [["before", "exterior"], ["damage"], ["during", "siding"], ["material", "delivery"], ["exterior"], ["after"]];
  const caps = ["North elevation before tear-off", "Rot under the kitchen window", "Wrap going on, day 2", "Siding delivery", "Front of house", "Finished south side"];
  ops.photos = caps.map((c, i) => ({ id: `66666666-0000-4000-8000-00000000000${i}`, customer_id: "55555555-5555-4555-8555-000000000001", estimate_id: EST, scope_section_id: i < 2 ? "77777777-7777-4777-8777-000000000001" : i === 2 ? "77777777-7777-4777-8777-000000000002" : null, storage_path: `c/${i}.jpg`, thumb_path: `c/${i}.webp`,
    width: 1600, height: 1200, taken_on: iso(6 - i).slice(0, 10), caption: c, labels: labels[i], ai_labels: i === 4 ? ["exterior", "siding", "windows"] : [], ai_status: null, created_at: iso(6 - i), uploaded_by: U, archived_at: null }));
}

export const opsRpc = {
  project_review_queue: () => [200, [
    { estimateId: EST, status: "needs_review", approvalSource: "signature", approvedAt: iso(0.2), reviewedAt: null, reviewedBy: null, reviewNote: null, companyId: null, ownerId: U, title: "Siding replacement – Johnson residence", customerName: "Pat Johnson", number: "B-1004", trades: ["siding"], stage: "won", scheduleId: null, scheduleStatus: null, canReview: true },
    { estimateId: "11111111-1111-4111-8111-111111111112", status: "reviewed", approvalSource: "manual", approvedAt: iso(3), reviewedAt: iso(2), reviewedBy: U, reviewNote: "Materials ordered", companyId: null, ownerId: U, title: "Deck rebuild – Lee", customerName: "Morgan Lee", number: "B-1003", trades: ["decks"], stage: "scheduled", scheduleId: null, scheduleStatus: null, canReview: true },
  ]],
  project_review_detail: () => [200, null],
  project_mark_reviewed: () => [200, null],
  my_notifications: () => [200, [{ id: "n1", kind: "task_review", scheduleId: null, taskId: null, reason: "planned_end", title: "Framing reached its planned end date", data: { project: "Deck Rebuild – Lee", task: "Framing", plannedEnd: iso(0).slice(0, 10), percent: 70 }, status: "open", readAt: null, snoozedUntil: null, createdAt: iso(0.1), canConfirm: true }]],
  // Quotes recorded during a walk persist in memory (subcontractor picker walk, V5 UX audit).
  can_record_sub_quotes: () => [200, true],
  sub_quote_record: ({ p }) => {
    const pp = typeof p === "string" ? JSON.parse(p) : p;
    if (pp.quoteId) {
      const q = recorded.find((x) => x.id === pp.quoteId);
      if (!q) return [400, { code: "22023", message: "unknown_quote" }];
      if (pp.amount) q.revisions.push(rev(crypto.randomUUID(), q.revisions.length + 1, Number(pp.amount), pp.note ?? null, 0));
      if (pp.status) q.status = pp.status;
      return [200, { id: q.id }];
    }
    const res = pp.resourceId ? (globalThis.__mockTeam?.list ?? []).find((r) => r.id === pp.resourceId) : null;
    if (pp.resourceId && !res) return [400, { code: "22023", message: "bad_resource" }];
    const name = (pp.vendorName ?? "").trim() || res?.name;
    if (!name) return [400, { code: "22023", message: "vendor_required" }];
    const q = { id: crypto.randomUUID(), itemId: pp.itemId, groupId: null, itemName: "", resourceId: pp.resourceId ?? null, vendorName: name, estimatedCost: 0, status: "received", internalNotes: pp.internalNotes ?? null, appliedRevisionId: null,
      revisions: pp.amount ? [rev(crypto.randomUUID(), 1, Number(pp.amount), "Original quote", 0)] : [] };
    recorded.push(q);
    return [200, { id: q.id }];
  },
  sub_quotes_for_estimate: () => [200, { canView: true, canRecord: true, canApply: true, quotes: [...quotes(), ...recorded], adjustments: [{ id: "88888888-8888-4888-8888-0000000000c1", itemId: item(4), groupId: G(2), quoteId: "88888888-8888-4888-8888-000000000002", revisionId: "88888888-8888-4888-8888-0000000000b1", amount: -150, forecastCost: 2250, note: null, createdAt: iso(4), createdBy: U }] }],
  project_proposal_history: () => [200, {
    estimate: { id: EST, title: "Siding replacement – Johnson residence", number: "B-1004", stage: "won", updatedAt: iso(0), ownerId: U, wonAt: iso(1), companyId: null },
    approval: { versionId: V2, source: "signature", total: 14980 },
    versions: [
      { id: V2, number: 2, createdAt: iso(1.2), total: 14980, contentHash: "b".repeat(64), authorId: U, hasPdf: true, sentAt: iso(1.2), signatures: [{ id: "sg2", signedAt: iso(1), signerName: "Pat Johnson", pdfStatus: "ready" }], openLink: false, approved: true },
      { id: V1, number: 1, createdAt: iso(5), total: 14250, contentHash: "a".repeat(64), authorId: U, hasPdf: true, sentAt: iso(5), signatures: [{ id: "sg1", signedAt: iso(4), signerName: "Pat Johnson", pdfStatus: "ready" }], openLink: false, approved: false },
    ],
    changeOrders: [
      { id: "99999999-9999-4999-8999-000000000001", number: 1, title: "Replace rotted sheathing", amount: 640, status: "signed", version: 1, approvedVersion: 1, approvalMethod: "signature", approvalNote: null, sentAt: iso(0.8), decidedAt: iso(0.6), createdAt: iso(0.9), updatedAt: iso(0.6), createdBy: U, description: "Sheathing behind the kitchen window was rotted.", lines: [{ kind: "add", description: "Replace 4 sheets of OSB", amount: 640 }], scheduleDays: 1, customerNotes: null, internalNotes: "Found during tear-off", signatures: [{ id: "cs1", signedAt: iso(0.6), signerName: "Pat Johnson", version: 1 }], openLink: false },
      { id: "99999999-9999-4999-8999-000000000002", number: 2, title: "Skip garage trim", amount: -220, status: "approved", version: 1, approvedVersion: 1, approvalMethod: "manual", approvalNote: "Approved by phone", sentAt: iso(0.5), decidedAt: iso(0.4), createdAt: iso(0.5), updatedAt: iso(0.4), createdBy: U, description: null, lines: [{ kind: "remove", description: "Garage trim wrap", amount: -220 }], scheduleDays: null, customerNotes: null, internalNotes: null, signatures: [], openLink: false },
      { id: "99999999-9999-4999-8999-000000000003", number: 3, title: "Upgrade to insulated siding", amount: 1850, status: "sent", version: 1, approvedVersion: null, approvalMethod: null, approvalNote: null, sentAt: iso(0.1), decidedAt: null, createdAt: iso(0.2), updatedAt: iso(0.1), createdBy: U, description: null, lines: [{ kind: "modify", description: "Insulated panels instead of standard", amount: 1850 }], scheduleDays: null, customerNotes: null, internalNotes: null, signatures: [], openLink: true },
    ],
    permissions: { create: true, send: true, accepted: true },
  }],
  can_manage_project_scope: () => [200, true],
  can_share_project_scope: () => [200, true],
  project_scope_shares: () => [200, ops.shares],
  project_scope_save: ({ p_section_id, p }) => { const s = ops.scope.find((x) => x.id === p_section_id); if (s) { s.revision++; if (p.resourceId !== undefined) s.resource_id = p.resourceId || null; } return [200, s?.revision ?? 1]; },
  can_upload_photos: () => [200, true],
  photo_update: () => [200, null],
  proposal_style_policy: () => [200, ops.styleManaged ? { managed: true, companyId: "c1", companyOwnerId: U, style: { template: "modern", primaryColor: "#0a5c36", secondaryColor: "#f2a900", show: { itemPrices: false } }, locked: ["template", "primaryColor"], allowCustomization: ops.allow, canCustomize: ops.allow, canOverride: ops.canOverride, revision: 4, updatedAt: iso(2) } : { managed: false }],
  proposal_style_reset: () => [200, null],
  company_proposal_style: () => [200, { companyId: "c1", exists: true, style: { template: "modern", primaryColor: "#0a5c36", secondaryColor: "#f2a900", companyBranding: true, show: { itemPrices: false, quantities: true } }, locked: ["template", "primaryColor", "show.itemPrices"],
    allowCustomization: false, revision: 4, updatedAt: iso(2), isOwner: true, canManageTemplate: true, canChangePolicy: true,
    history: [{ revision: 4, actorId: U, at: iso(2), allow: false, locked: ["template", "primaryColor", "show.itemPrices"] }, { revision: 3, actorId: U, at: iso(9), allow: true, locked: ["template"] }] }],
  company_proposal_style_save: () => [200, 5],
};

export const opsTables = {
  get project_scope_sections() { return ops.scope; },
  get project_photos() { return ops.photos; },
  project_reviews: [],
};

const COLORS = ["#8aa1b1", "#a0522d", "#6b8e23", "#c2a878", "#7a8fa6", "#5f9ea0"];
/** Signed photo URLs point back at the mock, which draws a placeholder image for each path. */
export function opsStorage(u, raw, send, res) {
  if (u.pathname === "/storage/v1/object/sign/project-photos") {
    let paths = []; try { paths = JSON.parse(raw || "{}").paths ?? []; } catch { /* ignore */ }
    send(res, 200, paths.map((p) => ({ path: p, signedURL: `/object/sign/project-photos/${p}?token=mock`, error: null })));
    return true;
  }
  if (u.pathname.startsWith("/storage/v1/object/sign/project-photos/")) {
    const i = Number((u.pathname.match(/(\d+)\.\w+$/) ?? [0, 0])[1]) % COLORS.length;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="${COLORS[i]}"/><rect x="120" y="180" width="560" height="320" fill="#fff" opacity=".25"/><polygon points="100,200 400,40 700,200" fill="#fff" opacity=".35"/><text x="400" y="560" font-size="34" text-anchor="middle" fill="#fff" font-family="sans-serif">Test photo ${i + 1}</text></svg>`;
    res.writeHead(200, { "content-type": "image/svg+xml" }); res.end(svg);
    return true;
  }
  return false;
}
