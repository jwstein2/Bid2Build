/**
 * Subcontractor compliance (20270104001000), against the real SQL:
 *   - full TINs: only compliance managers may log/see them; the table itself is service-role only
 *   - self-serve links: create (managers only) -> lookup -> submit once (W-9 + certificate) -> closed; revoke
 *   - expiry notices: due once per stage, emailed once per account per day (runComplianceNotices)
 *   - vendor compliance for the pay warning; payer details for 1099s
 *   - rollback removes everything and re-apply works
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { dbAvailable, freshDb, type Row } from "./harness";
import { pgSupabase } from "./pg-supabase";
import { asFn, fails, h, rowsFn, setupWorld, type World } from "./fin-fixtures";
import type { CommConfig } from "@/lib/comms/config";
import { runComplianceNotices } from "@/lib/team/compliance-notices";
import { sealPii, openPii } from "@/lib/security/pii";

const KEY = Buffer.alloc(32, 7).toString("base64");
const available = await dbAvailable();
const d = available ? describe : describe.skip;
let pool: Pool;
let drop: () => Promise<void>;
let w: World;

const cfg: CommConfig = {
  mode: "live", enabled: true, reason: null, apiKey: "re_test", fromAddress: "updates@built2bid.org", replyDomain: null,
  webhookSecret: "", inboundSecret: "", testRecipients: [], dailyCap: 300, accountDailyCap: 60,
};

d("subcontractor compliance (database)", () => {
  let as: ReturnType<typeof asFn>;
  let rows: ReturnType<typeof rowsFn>;
  let stone: string, reqHash: string, reqId: string;
  const save = (u: string, p: object) => as<{ id: string }>(u, "select public.pm_resource_save($1) as id", [p]).then((r) => r.id);

  beforeAll(async () => {
    ({ pool, drop } = await freshDb("byb_test_sub_compliance"));
    w = await setupWorld(pool);
    as = asFn(pool); rows = rowsFn(pool);
    stone = await save(w.owner, { kind: "subcontractor", name: "Stone Works", email: "stone@example.test" });
  }, 120_000);
  afterAll(async () => { await drop?.(); });

  it("full TINs: managers log access, others are refused, and nobody reads the table directly", async () => {
    expect(await fails(as(w.viewer, "select public.pm_sensitive_log($1, 'tin', 'revealed')", [stone]))).toMatch(/forbidden/);
    expect(await fails(as(w.rival, "select public.pm_sensitive_log($1, 'tin', 'revealed')", [stone]))).toMatch(/forbidden/);
    expect(await fails(as(w.owner, "select public.pm_sensitive_log($1, 'tin', 'submitted_by_sub')", [stone]))).toMatch(/bad_action/);
    expect((await as<{ r: string | null }>(w.owner, "select public.pm_sensitive_log($1, 'tin', 'saved') as r", [stone])).r).toBeNull();
    await pool.query("insert into public.pm_sensitive_ids (resource_id, kind, sealed, last4) values ($1, 'tin', $2, '6789')", [stone, sealPii("123456789", KEY)]);
    expect((await as<{ r: string }>(w.owner, "select public.pm_sensitive_log($1, 'tin', 'revealed') as r", [stone])).r).toBe("6789");
    expect(await fails(as(w.owner, "select * from public.pm_sensitive_ids"))).toMatch(/permission denied/);
    expect((await as<{ r: Row }>(w.owner, "select public.pm_sensitive_status($1, 'tin') as r", [stone])).r).toMatchObject({ onFile: true, last4: "6789" });
    expect((await as<{ r: Row | null }>(w.viewer, "select public.pm_sensitive_status($1, 'tin') as r", [stone])).r).toBeNull();
    expect((await rows(w.owner, "select action from public.pm_sensitive_access_log where resource_id = $1 order by at", [stone])).map((r) => r.action)).toEqual(["saved", "revealed"]);
    expect(await rows(w.viewer, "select 1 from public.pm_sensitive_access_log")).toHaveLength(0);
    expect(() => openPii(sealPii("987654321", KEY), Buffer.alloc(32, 8).toString("base64"))).toThrow();
  });

  it("self-serve link: managers create it; the sub submits a W-9 and a certificate once", async () => {
    reqHash = h("token-1");
    expect(await fails(as(w.viewer, "select public.pm_sub_request_create($1, $2)", [stone, { kinds: ["w9"], tokenHash: reqHash }]))).toMatch(/forbidden/);
    reqId = (await as<{ id: string }>(w.owner, "select public.pm_sub_request_create($1, $2) as id", [stone, { kinds: ["w9", "coi_general_liability"], toEmail: "stone@example.test", tokenHash: reqHash }])).id;
    const look = (await pool.query("select public.pm_sub_request_lookup($1) as r", [reqHash])).rows[0].r as Row;
    expect(look).toMatchObject({ state: "open", id: reqId, subName: "Stone Works", contractor: "Acme Decks", kinds: ["coi_general_liability", "w9"], folder: `${w.company}/${stone}` });
    expect(await fails(as(w.owner, "select public.pm_sub_request_lookup($1)", [reqHash]))).toMatch(/permission denied/);
    const submit = (p: object) => pool.query("select public.pm_sub_request_submit($1, $2) as r", [reqHash, p]);
    expect(await fails(submit({ documents: [{ docType: "coi_general_liability", filePath: `${w.rivalCompany}/x/evil.pdf`, fileName: "a.pdf" }] }))).toMatch(/bad_path/);
    expect(await fails(submit({ documents: [{ docType: "license", filePath: `${w.company}/${stone}/req-${reqId}/a.pdf`, fileName: "a.pdf" }] }))).toMatch(/not_requested/);
    expect(await fails(submit({ w9: { legalName: "Stone Works LLC", taxClassification: "nope", tinType: "ein", tinLast4: "4321", signedName: "Sam Stone" } }))).toMatch(/bad_w9/);
    await submit({
      w9: { legalName: "Stone Works LLC", taxClassification: "llc_p", tinType: "ein", tinLast4: "4321", address: "9 Rock Rd, Austin TX 78701", signedName: "Sam Stone" },
      sealedTin: sealPii("987654321", KEY),
      documents: [{ docType: "coi_general_liability", issuer: "Acme Mutual", expiresOn: "2026-11-25", filePath: `${w.company}/${stone}/req-${reqId}/coi.pdf`, fileName: "coi.pdf" }],
    });
    const tax = (await pool.query("select legal_name, tin_last4, signed_name, request_id from public.pm_sub_tax_profiles where resource_id = $1", [stone])).rows[0];
    expect(tax).toMatchObject({ legal_name: "Stone Works LLC", tin_last4: "4321", signed_name: "Sam Stone", request_id: reqId });
    const sealed = (await pool.query("select sealed, last4 from public.pm_sensitive_ids where resource_id = $1", [stone])).rows[0];
    expect(openPii(sealed.sealed, KEY)).toBe("987654321");
    expect(sealed.last4).toBe("4321");
    const docs = (await pool.query("select doc_type, status, request_id from public.pm_sub_documents where resource_id = $1 order by doc_type", [stone])).rows;
    expect(docs).toEqual([{ doc_type: "coi_general_liability", status: "on_file", request_id: reqId }, { doc_type: "w9", status: "on_file", request_id: reqId }]);
    expect((await pool.query("select public.pm_sub_request_lookup($1) as r", [reqHash])).rows[0].r).toEqual({ state: "completed" });
    expect(await fails(submit({ w9: { legalName: "x", taxClassification: "llc_p", tinType: "ein", tinLast4: "1111", signedName: "x" } }))).toMatch(/link_closed/);
    const listed = await rows(w.owner, "select id, completed_at is not null as done from public.pm_sub_doc_requests where resource_id = $1", [stone]);
    expect(listed).toEqual([{ id: reqId, done: true }]);
    expect(await rows(w.viewer, "select 1 from public.pm_sub_doc_requests")).toHaveLength(0);
  });

  it("a canceled link stops working", async () => {
    const hash = h("token-2");
    const id = (await as<{ id: string }>(w.owner, "select public.pm_sub_request_create($1, $2) as id", [stone, { kinds: ["license"], tokenHash: hash }])).id;
    expect(await fails(as(w.viewer, "select public.pm_sub_request_revoke($1)", [id]))).toMatch(/forbidden|not_found/);
    await as(w.owner, "select public.pm_sub_request_revoke($1)", [id]);
    expect((await pool.query("select public.pm_sub_request_lookup($1) as r", [hash])).rows[0].r).toEqual({ state: "revoked" });
  });

  it("expiry notices: one email per account, each document's stage only once", async () => {
    const due = (await pool.query("select doc_type, stage from public.pm_compliance_due('2026-11-20')")).rows;
    expect(due).toEqual([{ doc_type: "coi_general_liability", stage: "7_days" }]);
    const sends: { to: string; subject: string; text: string }[] = [];
    const fake = (async (_u: string, init: RequestInit) => { sends.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ id: "re_1" }), { status: 200 }); }) as unknown as typeof fetch;
    const out = await runComplianceNotices(pgSupabase(pool) as never, "2026-11-20", cfg, fake);
    expect(out).toMatchObject({ accounts: 1, sent: 1 });
    expect(sends).toHaveLength(1);
    expect(sends[0].to).toEqual(["owner@acme.test"]);
    expect(sends[0].subject).toMatch(/expiring soon/);
    expect(sends[0].text).toMatch(/Stone Works: General liability certificate expires in 5 days/);
    await runComplianceNotices(pgSupabase(pool) as never, "2026-11-21", cfg, fake);
    expect(sends).toHaveLength(1);
    await runComplianceNotices(pgSupabase(pool) as never, "2026-11-26", cfg, fake);
    expect(sends).toHaveLength(2);
    expect(sends[1].subject).toMatch(/has expired/);
    expect(await runComplianceNotices(pgSupabase(pool) as never, "2026-11-27", { ...cfg, enabled: false }, fake)).toMatchObject({ sent: 0 });
  });

  it("pay warning: vendor compliance reflects W-9 and current insurance; payer details for 1099s", async () => {
    const vendor = (await pool.query("insert into public.fin_vendors (book_id, resource_id, name, kind) values ($1, $2, 'Stone Works', 'subcontractor') returning id", [w.book, stone])).rows[0].id;
    const check = async () => (await as<{ r: Row[] }>(w.owner, "select public.fin_vendor_compliance($1) as r", [w.book])).r;
    expect(await check()).toEqual([{ vendorId: vendor, resourceId: stone, w9OnFile: true, insuranceOnFile: true, expired: [] }]);
    const past = (await pool.query("update public.pm_sub_documents set expires_on = current_date - 1 where resource_id = $1 and doc_type = 'coi_general_liability' returning expires_on::text as d", [stone])).rows[0].d;
    expect(await check()).toEqual([{ vendorId: vendor, resourceId: stone, w9OnFile: true, insuranceOnFile: false, expired: [{ docType: "coi_general_liability", expiresOn: past }] }]);
    expect(await fails(as(w.rival, "select public.fin_vendor_compliance($1)", [w.book]))).toMatch(/forbidden/);
    expect(await fails(as(w.owner, "select public.pm_payer_profile_save($1)", [{ legalName: "Acme Decks LLC", ein: "12345" }]))).toMatch(/bad_ein|check/);
    await as(w.owner, "select public.pm_payer_profile_save($1)", [{ legalName: "Acme Decks LLC", ein: "123456789", address: "1 Main St" }]);
    expect(await rows(w.owner, "select legal_name, ein from public.pm_payer_profiles")).toEqual([{ legal_name: "Acme Decks LLC", ein: "12-3456789" }]);
    expect(await rows(w.viewer, "select 1 from public.pm_payer_profiles")).toHaveLength(0);
    expect(await fails(as(w.viewer, "select public.pm_payer_profile_save($1)", [{ legalName: "Nope" }]))).toMatch(/forbidden/);
  });

  it("rollback removes everything and re-apply works", async () => {
    await pool.query(readFileSync("docs/workforce-gps/rollback_20270208001000.sql", "utf8"));
    await pool.query(readFileSync("docs/hr-records/rollback_20270205001000.sql", "utf8"));
    await pool.query(readFileSync("docs/team-records/rollback_20270105001000.sql", "utf8"));
    await pool.query(readFileSync("docs/team-records/rollback_20270104001000.sql", "utf8"));
    expect((await pool.query("select to_regclass('public.pm_sensitive_ids') as a, to_regclass('public.pm_sub_doc_requests') as b")).rows[0]).toEqual({ a: null, b: null });
    expect((await pool.query("select count(*)::int as n from public.pm_sub_documents where resource_id = $1", [stone])).rows[0].n).toBe(2);
    await pool.query(readFileSync("supabase/migrations/20270104001000_sub_compliance.sql", "utf8"));
    await pool.query(readFileSync("supabase/migrations/20270104001000_sub_compliance.sql", "utf8"));
    expect((await pool.query("select to_regclass('public.pm_sensitive_ids') as a")).rows[0].a).toBe("pm_sensitive_ids");
  });
});
