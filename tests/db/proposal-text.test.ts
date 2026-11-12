import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { asUser, createUser, dbAvailable, freshDb } from "./harness";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;

const SECRET_SCOPE = "Build the secret deck for Pat at 12 Main St";

const payload = (id: string, gid: string) => ({
  id, title: "Deck", trades: ["decks"], estimateNumber: "EST-1", estimateDate: "2026-11-01", expirationDate: "2026-12-01",
  status: "draft", customer: { name: "Pat" }, location: {}, pricing: { mode: "markup", percent: "25" }, fixedAdjustment: "0", taxRate: "0",
  displayMode: "by_group", defaultGroupVisibility: "names_only",
  groups: [{ id: gid, name: "Framing", visibility: null, sortOrder: 0 }],
  items: [{ id: crypto.randomUUID(), groupId: gid, name: "Joists", costType: "material", treatment: "marked_up", quantity: "14", unit: "each", unitCost: "24.50", taxable: true, showOnProposal: true, sortOrder: 0 }],
  proposalConfig: {
    scopeOfWork: SECRET_SCOPE,
    scope: { visible: true, source: "edited", style: "professional", generatedAt: null, generator: "rules:scope-v1", basedOn: null, updatedAt: null, history: [] },
    exclusionList: {
      visible: true, style: "professional", generatedAt: null, generator: null, basedOn: null, updatedAt: null, history: [],
      items: [
        { id: "a", category: "permits", title: "Permits", text: "Secret permit text", status: "approved", source: "generated" },
        { id: "b", category: "custom", title: "", text: "Mine", status: "approved", source: "manual" },
        { id: "c", category: "electrical", title: "Electrical", text: "x", status: "rejected", source: "generated" },
      ],
    },
  },
});

d("scope & exclusions: AI usage log and admin metrics", () => {
  let alice: string, admin: string;
  const eid = crypto.randomUUID(), gid = crypto.randomUUID();

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_proposal_text"));
    alice = await createUser(pool, "alice@test.dev");
    admin = await createUser(pool, "admin@test.dev");
    await pool.query("insert into public.admin_roles (user_id, role) values ($1, 'admin')", [admin]);
    await asUser(pool, alice, (q) => q("select public.save_estimate($1::jsonb)", [JSON.stringify(payload(eid, gid))]));
    await pool.query(
      `insert into public.ai_generations (user_id, estimate_id, kind, trade, style, engine, status, model, input_tokens, output_tokens, cost_usd)
       values ($1, $2, 'scope', 'decks', 'professional', 'ai', 'ok', 'claude-opus-5-5', 1500, 700, 0.02),
              ($1, $2, 'exclusions', 'decks', 'professional', 'ai', 'failed', 'claude-opus-5-5', 0, 0, 0),
              ($1, $2, 'scope', 'decks', 'simple', 'rules', 'fallback', null, 0, 0, 0)`,
      [alice, eid],
    );
  });
  afterAll(async () => { await drop?.(); });

  it("save_estimate keeps scope and exclusions inside proposal_config", async () => {
    const r = await asUser(pool, alice, (q) => q("select proposal_config -> 'exclusionList' -> 'items' as items, proposal_config ->> 'scopeOfWork' as scope from public.estimates where id = $1", [eid]));
    expect(r.rows[0].scope).toBe(SECRET_SCOPE);
    expect(r.rows[0].items).toHaveLength(3);
  });

  it("end users cannot read or write the AI usage log", async () => {
    await expect(asUser(pool, alice, (q) => q("select * from public.ai_generations"))).rejects.toThrow();
    await expect(asUser(pool, alice, (q) => q("insert into public.ai_generations (user_id, kind, engine, status) values ($1, 'scope', 'ai', 'ok')", [alice]))).rejects.toThrow();
    await expect(asUser(pool, alice, (q) => q("select public.ai_generation_spend_since(now() - interval '1 day')"))).rejects.toThrow();
  });

  it("non-admins are refused the metrics", async () => {
    await expect(pool.query("select public.admin_proposal_text_metrics($1)", [alice])).rejects.toThrow(/forbidden/);
    await expect(asUser(pool, alice, (q) => q("select public.admin_proposal_text_metrics($1)", [admin]))).rejects.toThrow();
  });

  it("admin metrics are aggregate-only and contain no proposal text", async () => {
    const r = await pool.query("select public.admin_proposal_text_metrics($1, 30) as m", [admin]);
    const m = r.rows[0].m;
    expect(m.scopes).toMatchObject({ with_scope: 1, edited: 1, manual: 0 });
    expect(m.exclusions).toMatchObject({ estimates_using: 1, approved_items: 2, approved_generated: 1, approved_manual: 1, suggestions_rejected: 1 });
    expect(m.exclusions.top_categories_by_trade).toEqual(expect.arrayContaining([{ trade: "decks", category: "permits", count: 1 }]));
    expect(m.generation).toMatchObject({ total: 3, ai: 2, rules: 1, failed: 1, estimates: 1, per_estimate: 3 });
    expect(Number(m.generation.cost_usd)).toBeCloseTo(0.02);
    const text = JSON.stringify(m);
    expect(text).not.toContain("secret");
    expect(text).not.toContain("Secret");
    expect(text).not.toContain("Pat");
  });

  it("spend helper sums cost for the budget ceiling", async () => {
    const r = await pool.query("select public.ai_generation_spend_since(now() - interval '1 day')::float as s");
    expect(r.rows[0].s).toBeCloseTo(0.02);
  });
});
