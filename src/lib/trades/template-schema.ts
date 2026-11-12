import { z } from "zod";
import type { TemplateItem, TradeTemplate } from "./catalog";
import { COST_TYPES, UNITS } from "./catalog";

const costTypes = COST_TYPES.map((c) => c.value) as [string, ...string[]];

export const templateItemSchema = z.object({
  name: z.string().trim().min(1).max(200),
  unit: z.enum(UNITS),
  costType: z.enum(costTypes),
  treatment: z.enum(["marked_up", "pass_through"]),
});

/** Stored in trade_templates.definition. Never contains prices. */
export const templateDefinitionSchema = z.object({
  groups: z.array(z.object({ name: z.string().trim().min(1).max(120), items: z.array(templateItemSchema).max(100) })).min(1).max(30),
  examples: z.array(templateItemSchema).max(10),
});
export type TemplateDefinition = z.infer<typeof templateDefinitionSchema>;

/** Line format used by the admin editor: "Name | unit | costType [| pass]". */
export function itemToLine(i: TemplateItem): string {
  return [i.name, i.unit, i.costType, ...(i.treatment === "pass_through" ? ["pass"] : [])].join(" | ");
}

export interface ParseResult { ok: true; definition: TemplateDefinition } 
export interface ParseError { ok: false; errors: string[] }

/**
 * Parse the admin editor text. Groups start with "## Group name"; "## Examples" holds the
 * faded example rows. Every other non-empty line is an item.
 */
export function parseTemplateText(text: string): ParseResult | ParseError {
  const errors: string[] = [];
  const groups: { name: string; items: TemplateItem[] }[] = [];
  const examples: TemplateItem[] = [];
  let current: TemplateItem[] | null = null;
  text.split(/\r?\n/).forEach((raw, idx) => {
    const line = raw.trim();
    if (!line || line.startsWith("#!")) return;
    if (line.startsWith("##")) {
      const name = line.replace(/^##\s*/, "");
      if (/^examples$/i.test(name)) current = examples;
      else { const g = { name, items: [] as TemplateItem[] }; groups.push(g); current = g.items; }
      return;
    }
    if (!current) { errors.push(`Line ${idx + 1}: add a "## Group name" heading before items.`); return; }
    const [name = "", unit = "each", costType = "material", pass] = line.split("|").map((s) => s.trim());
    const parsed = templateItemSchema.safeParse({ name, unit, costType, treatment: pass?.toLowerCase() === "pass" ? "pass_through" : "marked_up" });
    if (!parsed.success) { errors.push(`Line ${idx + 1}: "${line.slice(0, 60)}" needs a name, a valid unit and a valid cost type.`); return; }
    if (pass && pass.toLowerCase() !== "pass") { errors.push(`Line ${idx + 1}: the 4th field may only be "pass".`); return; }
    (current as TemplateItem[]).push(parsed.data as TemplateItem);
  });
  if (errors.length) return { ok: false, errors };
  const def = templateDefinitionSchema.safeParse({ groups, examples });
  if (!def.success) return { ok: false, errors: def.error.issues.map((i) => `${i.path.join(".") || "template"}: ${i.message}`) };
  return { ok: true, definition: def.data };
}

export function templateToText(t: Pick<TradeTemplate, "groups" | "examples">): string {
  const parts = t.groups.map((g) => [`## ${g.name}`, ...g.items.map(itemToLine)].join("\n"));
  parts.push(["## Examples", ...t.examples.map(itemToLine)].join("\n"));
  return parts.join("\n\n") + "\n";
}

export function definitionToTemplate(trade: string, version: number, def: TemplateDefinition): TradeTemplate {
  return { trade, version, groups: def.groups as TradeTemplate["groups"], examples: def.examples as TemplateItem[] };
}
