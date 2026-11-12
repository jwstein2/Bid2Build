import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { computeEstimate } from "@/lib/estimate/engine";
import { buildObservation, type ObservationPayload } from "@/lib/market/capture";
import { est, item } from "../helpers";
import { asUser, createUser, dbAvailable, freshDb } from "./harness";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;

function payload(opts: { price?: number; qty?: number; unit?: string; name?: string; zip?: string; costs?: boolean; date?: string } = {}): ObservationPayload {
  const e = est({
    location: { zip: opts.zip ?? "60614" },
    estimateDate: opts.date ?? new Date().toISOString().slice(0, 10),
    pricing: { mode: "markup", percent: "0" }, // unit price == unit cost, so tests can set prices directly
    items: [item("g1", String(opts.qty ?? 300), String(opts.price ?? 10), { name: opts.name ?? "Trex Enhance Basics deck boards", unit: opts.unit ?? "square foot" })],
    projectProfile: { measurements: { area_sqft: opts.qty ?? 300 } },
  });
  return buildObservation(e, computeEstimate(e), e.projectProfile, { sharePrices: true, shareCosts: opts.costs ?? true });
}

/** A real estimate + finalized version owned by the user (as record_export would create). */
async function version(userId: string, n = 1, estimateId?: string): Promise<{ estimateId: string; versionId: string }> {
  const eid = estimateId ?? (await pool.query("insert into public.estimates (user_id, title) values ($1, 'Deck') returning id", [userId])).rows[0].id;
  const hash = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "").slice(0, 64);
  const v = await pool.query(
    "insert into public.estimate_versions (estimate_id, user_id, version_number, content_hash, snapshot, proposal, total_cost, subtotal, tax, total) values ($1,$2,$3,$4,'{}','{}',0,0,0,0) returning id",
    [eid, userId, n, hash],
  );
  return { estimateId: eid, versionId: v.rows[0].id };
}

async function consent(userId: string, prices: boolean, costs = false) {
  await asUser(pool, userId, (q) => q(
    "insert into public.market_consent (user_id, share_prices, share_costs, policy_version) values ($1,$2,$3,'test') on conflict (user_id) do update set share_prices = excluded.share_prices, share_costs = excluded.share_costs",
    [userId, prices, costs]));
}

const capture = async (userId: string, versionId: string, p: ObservationPayload) =>
  (await pool.query("select public.market_capture($1, $2, $3::jsonb) as r", [userId, versionId, JSON.stringify(p)])).rows[0].r as string;

const report = async (caller: string, view: string, filters: Record<string, unknown> = {}) =>
  (await pool.query("select public.market_report($1, $2, $3::jsonb) as r", [caller, view, JSON.stringify(filters)])).rows[0].r;

/** n contributors, each with `each` captured bids at the given prices. */
async function contributors(n: number, each = 1, price = (i: number) => 10 + (i % 5) * 0.5, opts: Parameters<typeof payload>[0] = {}) {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const u = await createUser(pool, `c${crypto.randomUUID()}@test.dev`);
    await consent(u, true, true);
    for (let b = 0; b < each; b++) {
      const { versionId } = await version(u);
      expect(await capture(u, versionId, payload({ ...opts, price: price(i) }))).toBe("captured");
    }
    ids.push(u);
  }
  return ids;
}

d("market intelligence (database)", () => {
  let admin: string, alice: string, bob: string;

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_market"));
    admin = await createUser(pool, "admin@test.dev");
    await pool.query("insert into public.admin_roles (user_id, role) values ($1, 'admin')", [admin]);
    alice = await createUser(pool, "alice@test.dev");
    bob = await createUser(pool, "bob@test.dev");
  });
  afterAll(async () => { await drop?.(); });

  describe("capture", () => {
    it("captures nothing without consent", async () => {
      const { versionId } = await version(alice);
      expect(await capture(alice, versionId, payload())).toBe("no_consent");
      await consent(alice, false);
      expect(await capture(alice, versionId, payload())).toBe("no_consent");
      expect((await pool.query("select count(*)::int n from market.observations")).rows[0].n).toBe(0);
    });

    it("captures one observation per finalized version; repeats are duplicates", async () => {
      await consent(alice, true, false);
      const { versionId } = await version(alice);
      expect(await capture(alice, versionId, payload())).toBe("captured");
      expect(await capture(alice, versionId, payload())).toBe("duplicate");
      expect(await capture(alice, versionId, payload({ price: 99 }))).toBe("duplicate");
      expect((await pool.query("select count(*)::int n from market.observations where version_id = $1", [versionId])).rows[0].n).toBe(1);
    });

    it("refuses a version that belongs to someone else", async () => {
      await consent(bob, true);
      const { versionId } = await version(alice);
      await expect(capture(bob, versionId, payload())).rejects.toThrow(/version_not_found/);
    });

    it("strips costs in the database when cost sharing is off, even if the payload has them", async () => {
      const { versionId } = await version(alice);
      await capture(alice, versionId, payload({ costs: true }));
      const o = (await pool.query("select id, costs_shared, cost_total, gross_margin_pct from market.observations where version_id = $1", [versionId])).rows[0];
      expect(o).toMatchObject({ costs_shared: false, cost_total: null, gross_margin_pct: null });
      const l = (await pool.query("select unit_cost, unit_cost_norm, markup_pct from market.line_observations where observation_id = $1", [o.id])).rows;
      expect(l.every((r) => r.unit_cost === null && r.unit_cost_norm === null && r.markup_pct === null)).toBe(true);
    });

    it("a revision supersedes the earlier version so it isn't counted twice", async () => {
      const v1 = await version(alice, 1);
      const v2 = await version(alice, 2, v1.estimateId);
      await capture(alice, v2.versionId, payload({ price: 12 })); // out of order on purpose
      await capture(alice, v1.versionId, payload({ price: 11 }));
      const rows = (await pool.query("select version_number, is_latest from market.observations where estimate_id = $1 order by version_number", [v1.estimateId])).rows;
      expect(rows).toEqual([{ version_number: 1, is_latest: false }, { version_number: 2, is_latest: true }]);
    });

    it("stores no customer or business identifiers", async () => {
      const cols = (await pool.query("select table_name, column_name from information_schema.columns where table_schema = 'market'")).rows.map((r) => r.column_name);
      for (const banned of ["customer_name", "customer_email", "customer_phone", "project_address", "company_name", "email", "phone", "notes", "description"]) expect(cols).not.toContain(banned);
    });

    it("bid outcome updates flow into the observation", async () => {
      const { estimateId, versionId } = await version(alice);
      await capture(alice, versionId, payload());
      await asUser(pool, alice, (q) => q("insert into public.estimate_project_profiles (estimate_id, user_id, outcome) values ($1, $2, 'accepted')", [estimateId, alice]));
      expect((await pool.query("select status from market.observations where version_id = $1", [versionId])).rows[0].status).toBe("accepted");
    });

    it("does nothing when the capture flag is off", async () => {
      await pool.query("update public.feature_flags set enabled = false where key = 'market_capture'");
      const { versionId } = await version(alice);
      expect(await capture(alice, versionId, payload())).toBe("disabled");
      await pool.query("update public.feature_flags set enabled = true where key = 'market_capture'");
    });
  });

  describe("access control", () => {
    it("end users cannot read the analytics schema or call admin functions", async () => {
      await expect(asUser(pool, alice, (q) => q("select * from market.observations"))).rejects.toThrow(/permission denied/);
      await expect(asUser(pool, alice, (q) => q("select * from market.line_observations"))).rejects.toThrow(/permission denied/);
      await expect(asUser(pool, alice, (q) => q("select public.market_report($1, 'overview', '{}')", [alice]))).rejects.toThrow(/permission denied/);
      await expect(asUser(pool, alice, (q) => q("select public.market_capture($1, $1, '{}')", [alice]))).rejects.toThrow(/permission denied/);
      await expect(asUser(pool, alice, (q) => q("select public.market_seed_synthetic($1, '[]')", [alice]))).rejects.toThrow(/permission denied/);
    });

    it("users see only their own consent and project profiles", async () => {
      const r = await asUser(pool, bob, (q) => q("select user_id from public.market_consent"));
      expect(r.rows.map((x) => x.user_id)).toEqual([bob]);
      expect((await asUser(pool, bob, (q) => q("select * from public.estimate_project_profiles"))).rows).toHaveLength(0);
      await expect(asUser(pool, bob, (q) => q("insert into public.market_consent (user_id, share_prices, policy_version) values ($1, true, 'x')", [alice]))).rejects.toThrow();
    });

    it("a user cannot attach a profile to another user's estimate", async () => {
      const { estimateId } = await version(alice);
      await expect(asUser(pool, bob, (q) => q("insert into public.estimate_project_profiles (estimate_id, user_id) values ($1, $2)", [estimateId, bob]))).rejects.toThrow();
    });

    it("admin functions refuse non-admin callers", async () => {
      for (const sql of [
        "select public.market_report($1, 'overview', '{}')", "select public.market_anomalies($1, '{}')", "select public.market_refresh($1)",
        "select public.market_classifications($1, '{}')", "select public.market_settings($1)", "select public.market_clear_synthetic($1)",
      ]) await expect(pool.query(sql, [alice]), sql).rejects.toThrow(/forbidden/);
      await expect(report(admin, "overview")).resolves.toBeTruthy();
    });

    it("the minimum-contributor floor cannot be lowered below 20", async () => {
      await expect(pool.query("select public.market_update_settings($1, '{\"min_contributors\": 5}')", [admin])).rejects.toThrow(/check constraint/);
    });
  });

  describe("statistics and suppression", () => {
    it("computes median, quartiles and MAD", async () => {
      const r = (await pool.query("select market.summarize(array[1,2,3,4,100]::numeric[], 20, 20) s")).rows[0].s;
      expect(r).toMatchObject({ n: 5, suppressed: false, median: 3, p25: 2, p75: 4, mean: 22, mad: 1, iqr: 2 });
    });

    it("suppresses below 20 businesses; many bids from one business never count extra", async () => {
      await pool.query("truncate market.observations cascade");
      const one = await contributors(1, 30, () => 10, { zip: "85004" });
      expect(one).toHaveLength(1);
      const solo = await report(admin, "overview", { state: "AZ" });
      expect(solo.bids).toBe(30);
      expect(solo.project_value).toMatchObject({ suppressed: true, reason: "min_contributors", contributors: 1 });
      expect(solo.volume).toBeNull();
      expect(solo.distribution).toBeNull();

      await contributors(18, 1, () => 10, { zip: "85004" });
      expect((await report(admin, "overview", { state: "AZ" })).project_value).toMatchObject({ suppressed: true, contributors: 19 });
      await contributors(1, 1, () => 10, { zip: "85004" });
      const ok = await report(admin, "overview", { state: "AZ" });
      expect(ok.project_value).toMatchObject({ suppressed: false, contributors: 20 });
      expect(ok.project_value.median).toBe(3000); // 300 SF x $10
    });

    it("material segments are suppressed independently of the overall report", async () => {
      const m = await report(admin, "materials", { state: "AZ", q: "trex" });
      const key = m.keys.find((k: { material_key: string }) => k.material_key.startsWith("decking.composite.trex"));
      expect(key.price).toMatchObject({ suppressed: false, contributors: 20, median: 10 });
      const other = await report(admin, "materials", { state: "AZ", q: "nonexistent" });
      expect(other.keys).toEqual([]);
    });

    it("ZIP-level rows are only listed when they clear the threshold", async () => {
      const g = await report(admin, "geo", { level: "zip5" });
      expect(g.segments.map((s: { key: string }) => s.key)).toEqual(["85004"]);
    });
  });

  describe("anomaly detection", () => {
    let outlierVersion: string, unitVersion: string;
    it("flags prices far outside the peer distribution and suspected unit mix-ups", async () => {
      await pool.query("truncate market.observations cascade");
      await contributors(12, 1, (i) => 10 + (i % 4) * 0.4, { zip: "30303" });
      const u = await createUser(pool, "outlier@test.dev");
      await consent(u, true);
      outlierVersion = (await version(u)).versionId;
      await capture(u, outlierVersion, payload({ price: 31, zip: "30303" }));
      unitVersion = (await version(u)).versionId;
      await capture(u, unitVersion, payload({ price: 92, zip: "30303" })); // ~9x: SY vs SF
      const res = (await pool.query("select public.market_refresh($1) r", [admin])).rows[0].r;
      expect(res.anomalies.unit_price).toBeGreaterThanOrEqual(2);
      const a = (await pool.query("select public.market_anomalies($1, '{}') r", [admin])).rows[0].r;
      const kinds = a.items.map((x: { kind: string; value: number }) => `${x.kind}:${Math.round(x.value)}`);
      expect(kinds).toContain("high_price:31");
      expect(kinds).toContain("unit_conversion:92");
      // Normal prices are not flagged.
      expect(a.items.filter((x: { metric: string }) => x.metric === "unit_price")).toHaveLength(2);
      // Pseudonymous reference only; no estimate or user ids in the output.
      expect(JSON.stringify(a)).not.toContain(u);
      expect(a.items[0].contributor_ref).toMatch(/^[0-9a-f]{8}$/);
    });

    it("needs enough peers before judging", async () => {
      await pool.query("truncate market.observations cascade");
      await contributors(3, 1, (i) => (i === 2 ? 100 : 10), { zip: "30303" });
      const res = (await pool.query("select public.market_refresh($1) r", [admin])).rows[0].r;
      expect(res.anomalies.unit_price).toBe(0);
    });

    it("an admin decision of 'data entry error' excludes the observation; other decisions keep it", async () => {
      await pool.query("truncate market.observations cascade");
      await contributors(12, 1, () => 10, { zip: "30303" });
      const u = await createUser(pool, "typo@test.dev");
      await consent(u, true);
      const v = (await version(u)).versionId;
      await capture(u, v, payload({ price: 40, zip: "30303" }));
      await pool.query("select public.market_refresh($1)", [admin]);
      const a = (await pool.query("select public.market_anomalies($1, '{}') r", [admin])).rows[0].r.items[0];
      await pool.query("select public.market_review_anomaly($1, $2, 'data_entry_error', 'typo')", [admin, a.id]);
      expect((await pool.query("select count(*)::int n from market.line_observations where excluded_reason is not null")).rows[0].n).toBe(1);
      // Reviewed findings survive re-detection with their decision.
      await pool.query("select public.market_refresh($1)", [admin]);
      expect((await pool.query("select review_status from market.anomalies where id = $1", [a.id])).rows[0].review_status).toBe("data_entry_error");
      await pool.query("select public.market_review_anomaly($1, $2, 'genuine_premium', null)", [admin, a.id]);
      expect((await pool.query("select count(*)::int n from market.line_observations where excluded_reason is not null")).rows[0].n).toBe(0);
      expect((await pool.query("select count(*)::int n from public.audit_logs where action = 'market.anomaly.review'")).rows[0].n).toBe(2);
    });
  });

  describe("classification review", () => {
    it("queues low-confidence item text and applies corrections to past and future observations", async () => {
      const u = await createUser(pool, "vague@test.dev");
      await consent(u, true);
      await capture(u, (await version(u)).versionId, payload({ name: "Boards" }));
      const queue = (await pool.query("select public.market_classifications($1, '{\"status\":\"needs_review\"}') r", [admin])).rows[0].r.items;
      const fp = queue.find((c: { sample_name: string }) => c.sample_name === "Boards").fingerprint;
      await pool.query("select public.market_update_classification($1, $2, $3::jsonb)", [admin, fp, JSON.stringify({ component: "decking", material: "composite", category: "decking.composite", material_key: "decking.composite" })]);
      await capture(u, (await version(u)).versionId, payload({ name: "Boards" }));
      const lines = (await pool.query("select material_key, confidence::float c, class_method from market.line_observations where fingerprint = $1", [fp])).rows;
      expect(lines).toHaveLength(2);
      expect(lines.every((l) => l.material_key === "decking.composite" && l.c === 1 && l.class_method === "admin")).toBe(true);
    });
  });

  describe("consent withdrawal and deletion", () => {
    it("turning off cost sharing strips costs from past observations", async () => {
      const u = await createUser(pool, "costs@test.dev");
      await consent(u, true, true);
      await capture(u, (await version(u)).versionId, payload({ costs: true }));
      const q = "select o.costs_shared, o.cost_total, l.unit_cost from market.observations o join market.line_observations l on l.observation_id = o.id join market.contributors c on c.key = o.contributor where c.user_id = $1";
      expect((await pool.query(q, [u])).rows[0].costs_shared).toBe(true);
      await consent(u, true, false);
      expect((await pool.query(q, [u])).rows[0]).toEqual({ costs_shared: false, cost_total: null, unit_cost: null });
    });

    it("turning off sharing deletes the business's observations and records the change", async () => {
      const u = await createUser(pool, "leave@test.dev");
      await consent(u, true);
      await capture(u, (await version(u)).versionId, payload());
      const count = async () => (await pool.query("select count(*)::int n from market.observations o join market.contributors c on c.key = o.contributor where c.user_id = $1", [u])).rows[0].n;
      expect(await count()).toBe(1);
      await consent(u, false);
      expect(await count()).toBe(0);
      expect((await pool.query("select count(*)::int n from market.consent_events where user_id = $1", [u])).rows[0].n).toBe(2);
    });

    it("deleting an account or estimate deletes its observations", async () => {
      const u = await createUser(pool, "gone@test.dev");
      await consent(u, true);
      const v = await version(u);
      await capture(u, v.versionId, payload());
      await pool.query("delete from public.estimates where id = $1", [v.estimateId]);
      expect((await pool.query("select count(*)::int n from market.observations where estimate_id = $1", [v.estimateId])).rows[0].n).toBe(0);
      await capture(u, (await version(u)).versionId, payload());
      await pool.query("delete from auth.users where id = $1", [u]);
      expect((await pool.query("select count(*)::int n from market.contributors where user_id = $1", [u])).rows[0].n).toBe(0);
    });
  });

  describe("synthetic demo data", () => {
    it("is kept apart from real data and removable", async () => {
      await pool.query("truncate market.observations cascade");
      await contributors(20, 1, () => 10, { zip: "60614" });
      const rows = Array.from({ length: 25 }, (_, i) => ({ contributor: i, payload: payload({ price: 500, zip: "60614" }) }));
      expect((await pool.query("select public.market_seed_synthetic($1, $2::jsonb) n", [admin, JSON.stringify(rows)])).rows[0].n).toBe(25);
      const real = await report(admin, "overview");
      const fake = await report(admin, "overview", { dataset: "synthetic" });
      expect(real.bids).toBe(20);
      expect(real.project_value.median).toBe(3000);
      expect(fake.bids).toBe(25);
      expect(fake.meta.dataset).toBe("synthetic");
      expect(fake.project_value.median).toBe(150000);
      await pool.query("select public.market_clear_synthetic($1)", [admin]);
      expect((await report(admin, "overview", { dataset: "synthetic" })).bids).toBe(0);
      expect((await report(admin, "overview")).bids).toBe(20);
    });

    it("every report view runs", async () => {
      for (const v of ["overview", "trades", "materials", "labor", "geo", "quality"]) {
        const r = await report(admin, v, { trade: "decks" });
        expect(r.meta.view).toBe(v);
        expect(r.coverage).toBeTruthy();
      }
      await expect(report(admin, "nope")).rejects.toThrow(/unknown_view/);
    });
  });
});
