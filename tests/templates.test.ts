import { describe, expect, it } from "vitest";
import { trades } from "@/lib/trades/catalog";
import { parseTemplateText, templateDefinitionSchema, templateToText } from "@/lib/trades/template-schema";
import { createEstimate } from "@/lib/estimate/factory";

describe("trade templates", () => {
  it("every built-in template is valid and round-trips through the admin text format", () => {
    for (const t of trades) {
      expect(templateDefinitionSchema.safeParse({ groups: t.template.groups, examples: t.template.examples }).success, t.slug).toBe(true);
      const parsed = parseTemplateText(templateToText(t.template));
      expect(parsed.ok, t.slug).toBe(true);
      if (parsed.ok) expect(parsed.definition).toEqual({ groups: t.template.groups, examples: t.template.examples });
    }
  });

  it("rejects bad units, cost types and orphan items with line numbers", () => {
    const r = parseTemplateText("Orphan item | each | material\n## Framing\nStuds | furlong | material\nNails | box | magic\nOk | each | labor | maybe");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]).toMatch(/^Line 1/);
      expect(r.errors.some((e) => e.startsWith("Line 3"))).toBe(true);
      expect(r.errors.some((e) => e.startsWith("Line 4"))).toBe(true);
      expect(r.errors.some((e) => e.startsWith("Line 5"))).toBe(true);
    }
  });

  it("parses pass-through items and examples; templates carry no prices", () => {
    const r = parseTemplateText("## Permits\nBuilding permit | lump sum | permit | pass\n## Examples\nDumpster | load | delivery");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.definition.groups[0].items[0]).toEqual({ name: "Building permit", unit: "lump sum", costType: "permit", treatment: "pass_through" });
      expect(r.definition.examples).toHaveLength(1);
      expect(JSON.stringify(r.definition)).not.toMatch(/cost"|price/i);
    }
  });

  it("new estimates use an admin-published template version when given one", () => {
    const e = createEstimate("roofing", { template: { trade: "roofing", version: 7, groups: [{ name: "Tear-off", items: [] }], examples: [] } });
    expect(e.groups.map((g) => g.name)).toEqual(["Tear-off"]);
    expect(e.templateRef).toEqual({ trade: "roofing", version: 7 });
    expect(e.items).toHaveLength(0);
    // A template for a different trade is ignored.
    const f = createEstimate("roofing", { template: { trade: "siding", version: 9, groups: [{ name: "X", items: [] }], examples: [] } });
    expect(f.templateRef?.version).toBe(1);
  });
});
