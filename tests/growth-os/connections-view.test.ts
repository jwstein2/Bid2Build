import { describe, expect, it } from "vitest";
import { buildView, STATUS_LABEL } from "@/lib/growth-os/connections-view";
import { CONNECTORS } from "../../growth-os/connectors/registry";

describe("Connections page view model", () => {
  it("without the Growth OS database: registry baselines only, nothing live, banner source = registry", () => {
    const v = buildView(null);
    expect(v.source).toBe("registry");
    expect(v.cards).toHaveLength(CONNECTORS.length);
    expect(v.counts.verified_operational).toBe(0);
    expect(v.counts.limited).toBe(0);
    for (const c of v.cards) for (const o of c.operations) expect(["awaiting_authorization", "awaiting_platform_approval", "unsupported"]).toContain(o.status);
  });
  it("live overview: a simulated row can never render as verified, even if the payload says so", () => {
    const v = buildView({ env: "staging", generated_at: "2026-11-28T00:00:00Z", paused_connectors: ["youtube"], audit: [
      { at: "2026-11-28T00:00:00Z", actor: "w", action: "connector_alert", detail: { provider: "youtube", message: "Token refresh failed 3 times." } }],
      connectors: [
        { provider: "meta_business", name: "Meta", grp: "Meta", status: "verified_operational", is_simulated: true, operations: [{ op_key: "ads.read", label: "x", status: "verified_operational", scopes: ["ads_read"], missing_scopes: [], privileged: false, phase: 5 }], checks: [] },
        { provider: "youtube", name: "YouTube", grp: "Google", status: "awaiting_authorization", is_simulated: false, operations: [], checks: [{ at: "2026-11-28T00:00:00Z", kind: "refresh", outcome: "auth_error", missing_scopes: null }] },
      ] });
    expect(v.source).toBe("live");
    expect(v.cards[0]).toMatchObject({ status: "limited", simulated: true });
    expect(v.cards[0].operations[0].status).toBe("limited");
    expect(v.cards[1].paused).toBe(true);
    expect(v.alerts[0]).toMatchObject({ provider: "youtube" });
    expect(STATUS_LABEL[v.cards[1].status]).toBe("Awaiting authorization");
  });
  it("unknown status values from the database fall back to unsupported, never to a working status", () => {
    const v = buildView({ connectors: [{ provider: "stripe", status: "connected", operations: [{ op_key: "revenue.read", status: "ok" }] }] });
    expect(v.cards[0].status).toBe("unsupported");
    expect(v.cards[0].operations[0].status).toBe("unsupported");
  });
});
