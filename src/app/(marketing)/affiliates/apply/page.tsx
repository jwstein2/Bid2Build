import type { Metadata } from "next";
import Link from "next/link";
import { Container, Notice } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { PROGRAM } from "@/lib/affiliates/content";
import { apply } from "./actions";

export const metadata: Metadata = { title: "Apply: Affiliate Program", alternates: { canonical: "/affiliates/apply" } };

const ERR: Record<string, string> = {
  email: "Please enter a valid email address.", name: "Please enter your full legal name.", agree: "Please confirm you've read the program terms.",
  country: "The first release of the program supports U.S. affiliates only.", closed: "Applications are closed right now. Please check back later.",
  save: "Something went wrong saving your application. Please try again.", unavailable: "Applications aren't available on this server.",
};
const field = "mt-1 w-full rounded-md border border-line-strong bg-surface px-3 py-2";
const CATS = ["Roofing", "Remodeling", "Plumbing", "Electrical", "HVAC", "Landscaping", "Painting", "General contracting", "Business / marketing for trades", "Other"];

export default async function ApplyPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const sp = await searchParams;
  if (sp.ok) {
    return (
      <Container className="max-w-xl py-16">
        <h1 className="text-3xl font-extrabold text-ink">Thanks, we got your application</h1>
        <p className="mt-3 text-ink-soft">We review every application by hand and will email you either way. If you&apos;re approved, you&apos;ll sign in with the same email to finish a short setup.</p>
        <p className="mt-6"><Link className="underline" href="/affiliates">Back to the program page</Link></p>
      </Container>
    );
  }
  return (
    <Container className="max-w-2xl py-12">
      <h1 className="text-3xl font-extrabold text-ink">Apply to the Built2Bid Affiliate Program</h1>
      <p className="mt-2 text-ink-soft">{PROGRAM.short} {PROGRAM.annual}</p>
      {sp.err && <Notice tone="danger" className="mt-4">{ERR[sp.err] ?? ERR.save}</Notice>}
      <form action={apply} className="mt-6 space-y-5">
        <div className="hidden" aria-hidden><label>Website <input name="website" tabIndex={-1} autoComplete="off" /></label></div>
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-2 font-bold text-ink">About you</legend>
          <label className="text-sm font-semibold">Full legal name<input name="legal_name" required autoComplete="name" className={field} /></label>
          <label className="text-sm font-semibold">Email<input name="email" type="email" required autoComplete="email" className={field} /></label>
          <label className="text-sm font-semibold">Creator / display name <span className="font-normal text-muted">(optional)</span><input name="display_name" className={field} /></label>
          <label className="text-sm font-semibold">Business name <span className="font-normal text-muted">(optional)</span><input name="business_name" autoComplete="organization" className={field} /></label>
          <label className="text-sm font-semibold">Country
            <select name="country" defaultValue="US" className={field}><option value="US">United States</option><option value="XX">Outside the U.S.</option></select>
          </label>
        </fieldset>
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-2 font-bold text-ink">Your channel</legend>
          <label className="text-sm font-semibold">Main platform
            <select name="platform" defaultValue="youtube" className={field}>
              {["youtube", "instagram", "tiktok", "facebook", "podcast", "blog", "newsletter", "other"].map((p) => <option key={p} value={p}>{p === "youtube" ? "YouTube" : p[0].toUpperCase() + p.slice(1)}</option>)}
            </select>
          </label>
          <label className="text-sm font-semibold">Channel or site URL<input name="channel_url" type="url" placeholder="https://" className={field} /></label>
          <label className="text-sm font-semibold">Channel name<input name="channel_name" className={field} /></label>
          <label className="text-sm font-semibold">Approximate audience size<input name="audience_size" inputMode="numeric" className={field} /></label>
          <label className="text-sm font-semibold sm:col-span-2">Who is your audience?<textarea name="audience" rows={2} className={field} placeholder="For example: residential roofers in the Midwest, small remodeling companies" /></label>
          <div className="sm:col-span-2">
            <p className="text-sm font-semibold">Trades you cover</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {CATS.map((c) => <label key={c} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-line px-3 text-sm"><input type="checkbox" name="categories" value={c} />{c}</label>)}
            </div>
          </div>
          <label className="text-sm font-semibold sm:col-span-2">Anything else we should know? <span className="font-normal text-muted">(optional)</span><textarea name="note" rows={3} className={field} /></label>
        </fieldset>
        <div className="space-y-3 text-sm">
          <label className="flex items-start gap-2"><input type="checkbox" name="agree" required className="mt-1" /><span>I&apos;ve read the <Link className="underline" href="/affiliates/terms" target="_blank">program terms</Link>, including the disclosure rules and that commissions are paid annually, not monthly, and are not guaranteed.</span></label>
          <label className="flex items-start gap-2"><input type="checkbox" name="marketing_opt_in" className="mt-1" /><span>Email me occasional program updates (optional).</span></label>
        </div>
        <Button type="submit">Submit application</Button>
        <p className="text-xs text-muted">We use this information only to review your application and run the program. See our <Link className="underline" href="/privacy">privacy policy</Link>.</p>
      </form>
    </Container>
  );
}
