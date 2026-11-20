import Link from "next/link";
import { loadDashboard } from "@/lib/affiliates/server";
import { affiliateLink, cleanTag } from "@/lib/affiliates/link";
import { DISCLOSURES, PROGRAM, TALKING_POINTS, VIDEO_OUTLINE } from "@/lib/affiliates/content";
import { qrFor } from "@/lib/sales/qr";
import { CopyLink } from "@/components/affiliates/copy-link";

export const metadata = { title: "Resources" };

const PAGES = [{ v: "", l: "Home page" }, { v: "/pricing", l: "Pricing" }, { v: "/tools", l: "Free tools" }, { v: "/learn", l: "Learn" }];

/** Promotional resource center: link + QR generator, talking points, video outline, disclosures, brand assets. No fake testimonials. */
export default async function Resources({ searchParams }: { searchParams: Promise<{ c?: string; s?: string; to?: string }> }) {
  const { dash } = await loadDashboard("/affiliate-hub/resources");
  const sp = await searchParams;
  const to = PAGES.some((p) => p.v === sp.to) ? sp.to : "";
  const link = affiliateLink(dash.affiliate.code, { campaign: sp.c, source: sp.s, to });
  const qr = await qrFor(link);
  const field = "mt-1 block w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm";
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold">Resources</h1>
        <p className="mt-1 text-sm text-ink-soft">Everything you need to talk about Built2Bid honestly. {PROGRAM.annual}</p>
      </div>

      <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
        <h2 className="text-lg font-bold">Link and QR code generator</h2>
        <form className="mt-3 grid gap-3 sm:grid-cols-4">
          <label className="text-sm font-semibold">Campaign tag<input name="c" defaultValue={cleanTag(sp.c) ?? ""} placeholder="roof-estimate-video" className={field} /></label>
          <label className="text-sm font-semibold">Source<input name="s" defaultValue={cleanTag(sp.s) ?? ""} placeholder="youtube" className={field} /></label>
          <label className="text-sm font-semibold">Landing page<select name="to" defaultValue={to} className={field}>{PAGES.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}</select></label>
          <div className="flex items-end"><button type="submit" className="min-h-11 rounded-md bg-ink px-4 text-sm font-semibold text-white">Make link</button></div>
        </form>
        <CopyLink value={link} />
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <div className="h-36 w-36 rounded-lg border border-line bg-white p-2" role="img" aria-label="QR code for your link" dangerouslySetInnerHTML={{ __html: qr.svg }} />
          <a href={qr.png} download={`built2bid-affiliate-qr${cleanTag(sp.c) ? `-${cleanTag(sp.c)}` : ""}.png`} className="inline-flex min-h-11 items-center rounded-md border border-line-strong px-4 text-sm font-semibold">Download QR (PNG)</a>
        </div>
        <p className="mt-3 text-xs text-muted">Campaign tags show up in your earnings filters and calendar so you can see which videos work. Your link never expires.</p>
      </section>

      <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
        <h2 className="text-lg font-bold">Required disclosure (copy and use)</h2>
        <p className="mt-1 text-sm text-ink-soft">The FTC requires a clear disclosure every time, in the content itself, before the link. Also turn on YouTube&apos;s paid promotion label when it applies.</p>
        <ul className="mt-3 space-y-3">{DISCLOSURES.map((d) => <li key={d.where}><p className="text-xs font-semibold uppercase text-muted">{d.where}</p><CopyLink value={d.text} /></li>)}</ul>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
          <h2 className="text-lg font-bold">Product overview and talking points</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-soft">{TALKING_POINTS.map((t) => <li key={t}>{t}</li>)}</ul>
          <p className="mt-3 text-xs text-muted">Only describe what you&apos;ve seen yourself. Don&apos;t promise income, savings or results, and don&apos;t use reviews or testimonials you didn&apos;t write or get permission for.</p>
        </section>
        <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
          <h2 className="text-lg font-bold">Video outline</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-ink-soft">{VIDEO_OUTLINE.map((t) => <li key={t}>{t}</li>)}</ol>
        </section>
      </div>

      <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
        <h2 className="text-lg font-bold">Logos, screenshots and demo videos</h2>
        <ul className="mt-2 space-y-1 text-sm">
          <li><a className="underline" href="/icon.png" download>Built2Bid app icon (PNG)</a></li>
          <li><a className="underline" href="/opengraph-image.png" download>Built2Bid share image (PNG)</a></li>
          <li><Link className="underline" href="/pricing">Current pricing (always check before quoting prices)</Link></li>
          <li>Demo video: use the &quot;Watch demo&quot; video on the <Link className="underline" href="/">home page</Link>, or record your own walkthrough on a free account.</li>
        </ul>
        <p className="mt-2 text-xs text-muted">Use logos as provided, without changes. Need something else? Email partners@built2bid.org.</p>
      </section>
    </div>
  );
}
