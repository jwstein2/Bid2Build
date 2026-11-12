import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card } from "@/components/ui/misc";
import { requireAdmin } from "@/lib/admin/server";
import { getTrade, UNITS, COST_TYPES } from "@/lib/trades/catalog";
import { definitionToTemplate, templateDefinitionSchema, templateToText } from "@/lib/trades/template-schema";
import { setTemplatePublished } from "../../actions";
import { TemplateEditor } from "./editor";

export const dynamic = "force-dynamic";

export default async function EditTemplate({ params }: PageProps<"/admin/templates/[trade]">) {
  const { trade: slug } = await params;
  const trade = getTrade(slug);
  if (!trade) notFound();
  const { db } = await requireAdmin();
  const { data: versions } = await db.from("trade_templates").select("version, published, definition, created_at").eq("trade_slug", slug).order("version", { ascending: false }).limit(50);
  const newest = versions?.[0];
  const parsed = newest ? templateDefinitionSchema.safeParse(newest.definition) : null;
  const base = parsed?.success ? definitionToTemplate(slug, newest!.version, parsed.data) : trade.template;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/templates" className="text-sm text-ink-soft underline">All templates</Link>
        <h1 className="mt-1 text-3xl font-extrabold">{trade.name} template</h1>
        <p className="mt-1 text-sm text-ink-soft">Editing from v{base.version}{newest ? "" : " (built-in)"}. Saving creates v{Math.max(newest?.version ?? 0, trade.template.version) + 1}.</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <TemplateEditor trade={slug} initial={templateToText(base)} />
        <div className="space-y-4">
          <Card className="p-4 text-xs text-ink-soft">
            <p className="font-semibold text-ink">Format</p>
            <p className="mt-1"><code>## Section name</code> starts a section. <code>## Examples</code> holds the faded example rows (max 10).</p>
            <p className="mt-1">Items: <code>Name | unit | cost type</code>, add <code>| pass</code> for pass-through (billed at cost).</p>
            <p className="mt-2 font-semibold text-ink">Units</p><p>{UNITS.join(", ")}</p>
            <p className="mt-2 font-semibold text-ink">Cost types</p><p>{COST_TYPES.map((c) => c.value).join(", ")}</p>
          </Card>
          <Card className="p-4">
            <p className="text-sm font-semibold">Version history</p>
            {!versions?.length ? <p className="mt-1 text-xs text-muted">Only the built-in v{trade.template.version} exists.</p> : (
              <ul className="mt-2 space-y-2 text-sm">
                {versions.map((v) => (
                  <li key={v.version} className="flex items-center justify-between gap-2">
                    <span>v{v.version} {v.published ? <Badge tone="ok">Published</Badge> : <Badge>Draft</Badge>}<span className="block text-xs text-muted">{new Date(v.created_at).toLocaleDateString("en-US")}</span></span>
                    <form action={setTemplatePublished.bind(null, slug, v.version, !v.published)}>
                      <button className="text-xs font-semibold text-brand underline">{v.published ? "Unpublish" : "Publish"}</button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
