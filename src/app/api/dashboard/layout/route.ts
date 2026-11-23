import { z } from "zod";
import { createClient, getUser } from "@/lib/supabase/server";
import { fail, json, logError, rateLimit } from "@/lib/http/api";
import { allowed } from "@/lib/dashboard/access";
import { PAGES, onPage, widgetDef } from "@/lib/dashboard/registry";
import { MAX_WIDGETS, MODES, parseLayout, type WidgetInstance } from "@/lib/dashboard/schema";
import { loadViewer, pageArgs, saveLayout } from "@/lib/dashboard/server";
import { isMissing } from "@/lib/financials/loaders";

export const runtime = "nodejs";

/**
 * Saves dashboard layouts (V6.6). Only preferences are written here, never business records.
 *   save            the caller's own layout for a mode (autosave), with the revision it was based on
 *   reset           restore defaults for a mode (the caller's own layout is removed)
 *   company_default primary Enterprise account holder: the company default for everyone or one role
 * Authorization: a widget the caller can't access can't be added. Widgets already in their saved layout stay
 * (hidden) when access is lost, so they come back when access returns; they never render data meanwhile.
 */
const widget = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/), type: z.string().regex(/^[a-z0-9_]{1,40}$/),
  w: z.number().int().min(1).max(4), h: z.number().int().min(1).max(2), settings: z.record(z.string(), z.unknown()).default({}),
});
const layout = z.object({ template: z.string().regex(/^[a-z0-9_]{1,40}$/).nullable(), widgets: z.array(widget).max(MAX_WIDGETS) });
const mode = z.enum(MODES);
// Which page's layout (Home or Financials). Each person keeps one layout per page per mode.
const page = z.enum(PAGES).default("home");
const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), mode, page, layout, expectedRevision: z.number().int().min(1).nullable(), force: z.boolean().default(false), source: z.enum(["user", "setup", "template"]).default("user") }),
  z.object({ action: z.literal("reset"), mode, page }),
  z.object({ action: z.literal("company_default"), mode, page, role: z.enum(["owner", "manager", "estimator", "viewer"]).nullable(), layout: layout.nullable() }),
]);

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return fail(401, "not_authenticated", "Sign in required.");
  if (!(await rateLimit(`dashboard-layout:${user.id}`, 120, 60_000))) return fail(429, "rate_limited", "Saving too often. Wait a few seconds.");
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, "invalid", "That layout couldn't be saved.");
  const a = parsed.data;
  const db = await createClient();
  try {
    const viewer = await loadViewer(db, user.id);
    // Accountant Mode is a view preference for people with accounting authority; it never grants anything.
    if (a.mode === "accountant" && !viewer.accountantModeAllowed) return fail(403, "forbidden_mode", "Accountant Mode isn't available on your account.");

    if (a.action === "reset") {
      const { error } = await db.rpc("dashboard_layout_reset", { p_mode: a.mode, ...pageArgs(a.page) });
      if (error) return isMissing(error) ? fail(503, "not_installed", "Saving layouts turns on after a short database update.") : fail(500, "server_error", "Couldn't restore the defaults. Try again.");
      return json({ ok: true });
    }

    if (a.action === "company_default") {
      const clean = a.layout ? parseLayout({ ...a.layout, schemaVersion: 1 }) : null;
      // Company defaults use only known widgets; each member later sees just the ones they may access.
      const widgets = clean ? clean.widgets.filter((w) => { const def = widgetDef(w.type); return def && onPage(def, a.page, a.mode); }) : null;
      const { error } = await db.rpc("company_dashboard_default_save", { p_role: a.role, p_mode: a.mode, p_template: clean?.template ?? null, p_widgets: widgets, p_schema_version: 1, ...pageArgs(a.page) });
      if (error) {
        if (isMissing(error)) return fail(503, "not_installed", "Company defaults turn on after a short database update.");
        if (/forbidden/.test(error.message ?? "")) return fail(403, "forbidden", "Only the primary account holder can set company dashboard defaults.");
        return fail(500, "server_error", "Couldn't save the company default. Try again.");
      }
      return json({ ok: true });
    }

    // save: refuse widgets the caller can't access, except ones already in their saved layout (kept hidden).
    const { data: current } = await db.rpc("dashboard_layout_get", { p_mode: a.mode, ...pageArgs(a.page) });
    const mine = (current as { mine?: { widgets?: WidgetInstance[]; revision?: number } | null } | null)?.mine ?? null;
    const stored = new Map<string, string>((mine?.widgets ?? []).map((w) => [w.id, w.type]));
    const clean = parseLayout({ ...a.layout, schemaVersion: 1 });
    const refused: string[] = [];
    const widgets = clean.widgets.filter((w) => {
      const def = widgetDef(w.type);
      const keep = stored.get(w.id) === w.type || (def && onPage(def, a.page, a.mode) && allowed(viewer.access, def.requires));
      if (!keep) refused.push(w.type);
      return keep;
    });
    // Unknown new types are just dropped; a known widget the caller may not access is refused outright.
    if (refused.some((t) => widgetDef(t))) {
      return fail(403, "forbidden_widget", "You don't have access to one of those widgets.", { refused });
    }
    // "Keep mine" after a conflict: save over whatever is stored now (the person chose to).
    const expected = a.force ? (mine?.revision ?? null) : a.expectedRevision;
    const r = await saveLayout(db, a.mode, { ...clean, widgets }, expected, a.source, a.page);
    if (!r.ok) return fail(r.code === "conflict" ? 409 : r.code === "not_installed" ? 503 : r.code === "invalid" ? 400 : 500, r.code, r.message);
    return json({ ok: true, revision: r.revision });
  } catch (e) {
    logError("dashboard.layout", e);
    return fail(500, "server_error", "Couldn't save your dashboard. Your changes are kept on this device; try again.");
  }
}
