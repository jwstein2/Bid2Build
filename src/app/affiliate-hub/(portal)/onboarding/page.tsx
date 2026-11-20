import Link from "next/link";
import { redirect } from "next/navigation";
import { Check, Circle } from "lucide-react";
import { Notice } from "@/components/ui/misc";
import { cn } from "@/lib/cn";
import { loadAffiliate } from "@/lib/affiliates/server";
import { LESSONS, PROGRAM } from "@/lib/affiliates/content";
import { youtubeConfigured } from "@/lib/affiliates/youtube";
import { piiReady } from "@/lib/security/pii";
import { acceptAgreement, channelDone, completeLesson, connectBank, importYoutube, learnDone, requestCorrection, saveChannelSelf, saveProfile, submitOnboarding, submitW9, welcomeSeen } from "./actions";

export const metadata = { title: "Setup" };

const field = "mt-1 w-full rounded-md border border-line-strong bg-surface px-3 py-2";
const primary = "inline-flex min-h-11 items-center justify-center rounded-lg bg-ink px-5 font-semibold text-white";
const secondary = "inline-flex min-h-11 items-center justify-center rounded-lg border border-line-strong px-5 font-semibold";

const ERR: Record<string, string> = {
  required: "Please fill in every required field (name, phone, street, city, country).", youtube_off: "YouTube import isn't switched on yet. Add your channel by hand below; we'll verify it later.",
  bad_input: "Enter a YouTube channel URL, @handle or channel ID.", not_found: "We couldn't find that YouTube channel.", channel_claimed: "That channel is already connected to another affiliate account. Contact partners@built2bid.org if it's yours.",
  youtube_error: "YouTube didn't respond. Please try again in a minute.", save_failed: "We couldn't save the channel. Please try again.", url: "Enter the channel's full https:// address.",
  use_correction: "Your channel numbers come from YouTube. To change them, request a correction below.", correction: "Please choose a field and enter the corrected value.",
  channel_required: "Add your channel first.", lessons: "Please finish all 10 short lessons first.", agree: "Please read the agreement, tick the box and type your full name.",
  pii: "Tax forms can't be accepted on this server yet (encryption key missing). The owner has been told; please try again later.",
  w9: "Please complete every W-9 field and certify it.", us_only: "The first release of the program pays U.S. affiliates only.", expired: "That bank connection session expired. Please start again.",
  no_method: "No bank account was added on the provider's page. Please try again.", provider_not_configured: "Bank connections aren't switched on yet. You can finish setup and connect your bank later.",
  incomplete: "A few steps still need finishing.",
};
const OK: Record<string, string> = { imported: "Channel imported from YouTube.", saved: "Channel saved.", correction: "Correction sent for review.", w9: "W-9 received.", bank: "Bank account connected.", bank_changed: "Bank account changed. Payouts go to it after the safety hold." };

export default async function Onboarding({ searchParams }: { searchParams: Promise<{ step?: string; err?: string; ok?: string; lesson?: string }> }) {
  const a = await loadAffiliate("/affiliate-hub/onboarding");
  if (a.kind !== "affiliate") redirect("/affiliate-hub");
  const { me } = a;
  const sp = await searchParams;
  const steps = me.onboarding.steps;
  const firstOpen = steps.find((x) => !x.done)?.key ?? "finish";
  const step = steps.some((x) => x.key === sp.step) ? sp.step! : firstOpen;
  const ch = me.channel as null | { platform: string; url: string | null; title: string | null; handle: string | null; description: string | null; subscriber_count: number | null; self_reported_audience: number | null;
    data_source: string; verify_code: string | null; verified_at: string | null; fetched_at: string | null; thumbnail_url: string | null; subscribers_hidden: boolean; view_count: number | null; video_count: number | null };
  const imported = ch?.data_source === "youtube_api" || ch?.data_source === "admin_corrected";

  return (
    <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
      <aside>
        <h1 className="text-2xl font-extrabold">Affiliate setup</h1>
        <p className="mt-1 text-sm text-ink-soft">About 15 minutes. You can stop and come back anytime.</p>
        <ol className="mt-4 space-y-1">
          {steps.map((x, i) => (
            <li key={x.key}>
              <Link href={`/affiliate-hub/onboarding?step=${x.key}`} aria-current={x.key === step ? "step" : undefined}
                className={cn("flex min-h-11 items-center gap-2 rounded-md px-2 text-sm", x.key === step ? "bg-surface font-bold shadow-card" : "text-ink-soft hover:bg-surface")}>
                {x.done ? <Check className="h-4 w-4 text-ok" aria-hidden /> : <Circle className="h-4 w-4 text-muted" aria-hidden />}
                <span>{i + 1}. {x.label}</span><span className="sr-only">{x.done ? " (done)" : " (to do)"}</span>
              </Link>
            </li>
          ))}
        </ol>
      </aside>

      <section className="rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
        {sp.err && <Notice tone="danger" className="mb-4">{ERR[sp.err] ?? "Something went wrong. Please try again."}</Notice>}
        {sp.ok && OK[sp.ok] && <Notice tone="ok" className="mb-4">{OK[sp.ok]}</Notice>}

        {step === "welcome" && (
          <div className="space-y-4">
            <h2 className="text-2xl font-extrabold">Welcome to the Built2Bid Affiliate Program</h2>
            <p className="text-ink-soft">{PROGRAM.short}</p>
            <ul className="list-disc space-y-1 pl-5 text-sm text-ink-soft">
              <li><strong className="text-ink">{PROGRAM.annual}</strong></li>
              <li>Each customer can earn you up to 10 annual commissions, starting with their first payment.</li>
              <li>Every commission waits 30 days, then is paid by ACH to your U.S. bank account.</li>
              <li>{PROGRAM.noGuarantee}</li>
            </ul>
            <p className="text-sm text-ink-soft">Next: your details, your channel, a short training, the agreement, and your tax and payout info. Your link goes live once Built2Bid approves your setup.</p>
            <form action={welcomeSeen}><button type="submit" className={primary}>Get started</button></form>
          </div>
        )}

        {step === "profile" && (
          <form action={saveProfile} className="space-y-4">
            <h2 className="text-2xl font-extrabold">Your information</h2>
            <p className="text-sm text-ink-soft">Used to run the program and pay you. Never shown to customers.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-semibold">Full legal name *<input name="legal_name" required defaultValue={me.legal_name ?? ""} autoComplete="name" className={field} /></label>
              <label className="text-sm font-semibold">Creator / display name<input name="display_name" defaultValue={me.display_name ?? ""} className={field} /></label>
              <label className="text-sm font-semibold">Business name<input name="business_name" defaultValue={me.business_name ?? ""} autoComplete="organization" className={field} /></label>
              <label className="text-sm font-semibold">Phone *<input name="phone" required type="tel" defaultValue={me.phone ?? ""} autoComplete="tel" className={field} /></label>
              <label className="text-sm font-semibold sm:col-span-2">Street address *<input name="address_line1" required defaultValue={me.address_line1 ?? ""} autoComplete="address-line1" className={field} /></label>
              <label className="text-sm font-semibold sm:col-span-2">Apt, suite <span className="font-normal text-muted">(optional)</span><input name="address_line2" defaultValue={me.address_line2 ?? ""} autoComplete="address-line2" className={field} /></label>
              <label className="text-sm font-semibold">City *<input name="city" required defaultValue={me.city ?? ""} autoComplete="address-level2" className={field} /></label>
              <label className="text-sm font-semibold">State<input name="state" defaultValue={me.state ?? ""} autoComplete="address-level1" className={field} /></label>
              <label className="text-sm font-semibold">ZIP code<input name="postal_code" defaultValue={me.postal_code ?? ""} autoComplete="postal-code" className={field} /></label>
              <label className="text-sm font-semibold">Country *<select name="country" defaultValue={me.country ?? "US"} className={field}><option value="US">United States</option><option value="XX">Other</option></select></label>
              <label className="text-sm font-semibold">Tax residency *<select name="tax_residency" defaultValue={me.tax_residency ?? "US"} className={field}><option value="US">United States</option><option value="XX">Other</option></select></label>
              <label className="text-sm font-semibold">Best way to reach you<select name="contact_pref" defaultValue={me.contact_pref ?? "email"} className={field}><option value="email">Email</option><option value="phone">Phone</option><option value="text">Text</option></select></label>
            </div>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="marketing_opt_in" defaultChecked={me.marketing_opt_in} className="mt-1" />Email me program updates and tips (optional).</label>
            <p className="text-xs text-muted">The first release pays U.S. affiliates only. If you&apos;re outside the U.S., you can still finish setup; payouts will open when we support your country.</p>
            <button type="submit" className={primary}>Save and continue</button>
          </form>
        )}

        {step === "channel" && (
          <div className="space-y-6">
            <h2 className="text-2xl font-extrabold">Your channel</h2>
            {ch ? (
              <div className="rounded-xl border border-line p-4">
                <div className="flex items-start gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element -- YouTube thumbnail URL from the API */}
                  {ch.thumbnail_url && <img src={ch.thumbnail_url} alt="" width={56} height={56} className="rounded-full" />}
                  <div className="min-w-0">
                    <p className="font-bold">{ch.title ?? ch.url}</p>
                    <p className="break-all text-sm text-ink-soft">{ch.handle ?? ch.url}</p>
                    <p className="mt-1 text-sm">
                      {imported ? <>Subscribers: {ch.subscribers_hidden ? "hidden by the channel" : (ch.subscriber_count ?? 0).toLocaleString()} · Videos: {(ch.video_count ?? 0).toLocaleString()} <span className="text-xs text-muted">(from YouTube{ch.fetched_at ? `, ${new Date(ch.fetched_at).toLocaleDateString()}` : ""})</span></>
                        : <>Audience (self-reported): {ch.self_reported_audience?.toLocaleString() ?? "not given"}</>}
                    </p>
                    <p className="mt-1 text-sm">{ch.verified_at ? <span className="font-semibold text-ok">Ownership verified</span> : imported ? <>Ownership not verified yet. Add <code className="rounded bg-paper px-1 font-bold">{ch.verify_code}</code> anywhere in your channel description, then import again. You can remove it after.</> : "We'll verify ownership during review."}</p>
                  </div>
                </div>
              </div>
            ) : <p className="text-sm text-ink-soft">Connect the main channel you&apos;ll promote Built2Bid on.</p>}

            <form action={importYoutube} className="space-y-2 rounded-xl border border-line p-4">
              <h3 className="font-bold">Import from YouTube</h3>
              <p className="text-sm text-ink-soft">We read public channel data (name, subscribers, videos) from YouTube. Imported numbers can&apos;t be edited directly; you can request a correction.</p>
              {!youtubeConfigured() && <p className="text-sm text-warn">YouTube import isn&apos;t switched on yet. Use the manual option below.</p>}
              <label className="block text-sm font-semibold">Channel URL, @handle or channel ID<input name="channel" placeholder="https://www.youtube.com/@yourchannel" className={field} /></label>
              <button type="submit" className={secondary} disabled={!youtubeConfigured()}>Import channel</button>
            </form>

            {!imported && (
              <form action={saveChannelSelf} className="space-y-3 rounded-xl border border-line p-4">
                <h3 className="font-bold">{ch ? "Edit your channel" : "Or add your channel by hand"}</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-sm font-semibold">Platform<select name="platform" defaultValue={ch?.platform ?? "youtube"} className={field}>{["youtube", "instagram", "tiktok", "facebook", "podcast", "blog", "newsletter", "other"].map((p) => <option key={p} value={p}>{p}</option>)}</select></label>
                  <label className="text-sm font-semibold">URL<input name="url" type="url" required defaultValue={ch?.url ?? ""} placeholder="https://" className={field} /></label>
                  <label className="text-sm font-semibold">Name<input name="title" defaultValue={ch?.title ?? ""} className={field} /></label>
                  <label className="text-sm font-semibold">Audience size<input name="audience" inputMode="numeric" defaultValue={ch?.self_reported_audience ?? ""} className={field} /></label>
                  <label className="text-sm font-semibold sm:col-span-2">Short description<textarea name="description" rows={2} defaultValue={ch?.description ?? ""} className={field} /></label>
                </div>
                <button type="submit" className={secondary}>Save channel</button>
              </form>
            )}

            {imported && (
              <form action={requestCorrection} className="space-y-3 rounded-xl border border-line p-4">
                <h3 className="font-bold">Request a correction</h3>
                <p className="text-sm text-ink-soft">Something wrong in the imported data? Tell us and an admin will review it.</p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="text-sm font-semibold">Field<select name="field" className={field}><option value="subscriber_count">Subscribers</option><option value="title">Channel name</option><option value="handle">Handle</option><option value="url">URL</option><option value="channel_country">Country</option></select></label>
                  <label className="text-sm font-semibold">Correct value<input name="value" required className={field} /></label>
                  <label className="text-sm font-semibold">Note<input name="note" className={field} /></label>
                </div>
                <button type="submit" className={secondary}>Send for review</button>
                {me.corrections.length > 0 && (
                  <ul className="text-sm text-ink-soft">{me.corrections.map((c) => <li key={c.id}>{c.field}: {c.proposed_value} · <strong>{c.status}</strong>{c.review_note ? ` (${c.review_note})` : ""}</li>)}</ul>
                )}
              </form>
            )}
            <form action={channelDone}><button type="submit" className={primary} disabled={!ch}>Continue</button></form>
          </div>
        )}

        {step === "learn" && (() => {
          const done = new Set(me.lessons);
          const current = LESSONS.find((l) => l.key === sp.lesson) ?? LESSONS.find((l) => !done.has(l.key)) ?? LESSONS[LESSONS.length - 1];
          return (
            <div className="space-y-4">
              <h2 className="text-2xl font-extrabold">Affiliate training</h2>
              <p className="text-sm text-ink-soft">Ten short lessons ({done.size} of {LESSONS.length} done). They cover how you&apos;re paid and the rules that keep your commissions safe.</p>
              <div className="flex flex-wrap gap-2">
                {LESSONS.map((l, i) => (
                  <Link key={l.key} href={`/affiliate-hub/onboarding?step=learn&lesson=${l.key}`} aria-current={l.key === current.key ? "step" : undefined}
                    className={cn("inline-flex min-h-11 items-center gap-1 rounded-md border px-3 text-sm", l.key === current.key ? "border-ink font-bold" : "border-line", done.has(l.key) && "text-ok")}>
                    {done.has(l.key) && <Check className="h-4 w-4" aria-hidden />}{i + 1}
                  </Link>
                ))}
              </div>
              <article className="rounded-xl border border-line p-5">
                <h3 className="text-lg font-bold">{current.title}</h3>
                {current.body.map((p) => <p key={p} className="mt-2 text-ink-soft">{p}</p>)}
                {current.check && <p className="mt-3 rounded-lg bg-paper p-3 text-sm"><strong>Check:</strong> {current.check.q} <span className="text-ink-soft">Answer: {current.check.a}</span></p>}
                <form action={completeLesson} className="mt-4">
                  <input type="hidden" name="lesson" value={current.key} />
                  <button type="submit" className={secondary}>{done.has(current.key) ? "Next lesson" : "I understand"}</button>
                </form>
              </article>
              <form action={learnDone}><button type="submit" className={primary} disabled={done.size < LESSONS.length}>Finish training</button></form>
            </div>
          );
        })()}

        {step === "agreement" && me.agreement && (
          <div className="space-y-4">
            <h2 className="text-2xl font-extrabold">{me.agreement.title} <span className="text-base font-normal text-muted">version {me.agreement.version}</span></h2>
            {me.agreement.legal_status !== "counsel_approved" && <Notice tone="warn" title="Legal review pending">This agreement is a draft awaiting attorney review. If the final version changes, you&apos;ll be asked to review and accept it again.</Notice>}
            <div tabIndex={0} aria-label="Agreement text" className="max-h-[28rem] overflow-y-auto whitespace-pre-wrap rounded-xl border border-line bg-paper p-4 text-sm leading-relaxed">{me.agreement.body}</div>
            {me.agreement.accepted_at ? <p className="font-semibold text-ok">Accepted {new Date(me.agreement.accepted_at).toLocaleString()}.</p> : (
              <form action={acceptAgreement} className="space-y-3">
                <input type="hidden" name="id" value={me.agreement.id} />
                <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="agree" required className="mt-1" />I have read and agree to this Affiliate Agreement, including that commissions are paid annually and are not guaranteed.</label>
                <label className="block max-w-sm text-sm font-semibold">Type your full legal name to sign<input name="typed_name" required autoComplete="name" className={field} /></label>
                <button type="submit" className={primary}>Sign agreement</button>
              </form>
            )}
            {me.agreement.accepted_at && <Link href="/affiliate-hub/onboarding?step=payout" className={primary}>Continue</Link>}
          </div>
        )}

        {step === "payout" && (
          <div className="space-y-6">
            <h2 className="text-2xl font-extrabold">Tax form and payouts</h2>
            {!me.onboarding.us_payouts ? <Notice tone="warn">The first release pays U.S. affiliates only. You can finish setup now; we&apos;ll contact you when payouts open in your country.</Notice> : (
              <>
                <div className="rounded-xl border border-line p-4">
                  <h3 className="font-bold">1. W-9 (U.S. taxpayer information)</h3>
                  {me.onboarding.w9_status === "submitted" || me.onboarding.w9_status === "verified"
                    ? <p className="mt-2 text-sm text-ok">W-9 on file (tax ID ending {me.onboarding.tin_last4}). <span className="text-ink-soft">To change it, submit a new one below.</span></p>
                    : <p className="mt-2 text-sm text-ink-soft">Required before we can pay you. Your tax ID is encrypted; only the last 4 digits are shown in the app.</p>}
                  {!piiReady() && <p className="mt-2 text-sm text-warn">Tax forms can&apos;t be accepted on this server yet.</p>}
                  <form action={submitW9} className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="text-sm font-semibold">Name (as on your tax return)<input name="legal_name" required defaultValue={me.legal_name ?? ""} className={field} /></label>
                    <label className="text-sm font-semibold">Business name <span className="font-normal text-muted">(if different)</span><input name="business_name" defaultValue={me.business_name ?? ""} className={field} /></label>
                    <label className="text-sm font-semibold">Federal tax classification<select name="tax_class" className={field}>
                      <option value="individual">Individual / sole proprietor / single-member LLC</option><option value="c_corp">C corporation</option><option value="s_corp">S corporation</option>
                      <option value="partnership">Partnership</option><option value="trust_estate">Trust / estate</option><option value="llc_c">LLC taxed as C corp</option><option value="llc_s">LLC taxed as S corp</option><option value="llc_p">LLC taxed as partnership</option><option value="other">Other</option>
                    </select></label>
                    <label className="text-sm font-semibold">Exempt payee code <span className="font-normal text-muted">(if any)</span><input name="exempt_code" maxLength={4} className={field} /></label>
                    <label className="text-sm font-semibold">Tax ID type<select name="tin_type" className={field}><option value="ssn">SSN</option><option value="ein">EIN</option><option value="itin">ITIN</option></select></label>
                    <label className="text-sm font-semibold">Tax ID number<input name="tin" required inputMode="numeric" autoComplete="off" className={field} /></label>
                    <label className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" name="certify" required className="mt-1" /><span>Under penalties of perjury, I certify that the number shown is my correct taxpayer identification number, I am not subject to backup withholding (or I&apos;ve been notified I no longer am), I am a U.S. citizen or other U.S. person, and any FATCA code entered is correct.</span></label>
                    <label className="text-sm font-semibold">Signature (type your full name)<input name="signed_name" required className={field} /></label>
                    <div className="flex items-end"><button type="submit" className={secondary} disabled={!piiReady()}>Submit W-9</button></div>
                  </form>
                </div>
                <div className="rounded-xl border border-line p-4">
                  <h3 className="font-bold">2. Payout bank account</h3>
                  {me.onboarding.destination ? (
                    <p className="mt-2 text-sm">{me.onboarding.destination.institution_name} ••{me.onboarding.destination.last4} · <span className={me.onboarding.destination.status === "verified" ? "text-ok" : "text-warn"}>{me.onboarding.destination.status}</span>{me.onboarding.destination.mode === "test" && <span className="text-muted"> (practice)</span>}</p>
                  ) : <p className="mt-2 text-sm text-ink-soft">Connect a U.S. checking or savings account on our payment provider&apos;s secure page. Built2Bid never receives your full account or routing number.</p>}
                  <form action={connectBank} className="mt-3"><button type="submit" className={secondary}>{me.onboarding.destination ? "Change bank account" : "Connect bank account"}</button></form>
                </div>
              </>
            )}
            <Link href="/affiliate-hub/onboarding?step=finish" className={primary}>Continue</Link>
          </div>
        )}

        {step === "finish" && (
          <div className="space-y-4">
            <h2 className="text-2xl font-extrabold">{me.status === "pending_review" ? "Setup submitted" : "Finish setup"}</h2>
            {me.status === "pending_review" || sp.ok === "submitted" ? (
              <p className="text-ink-soft">Thanks! Built2Bid is reviewing your setup. We&apos;ll email you when your link is live (usually within a few business days).</p>
            ) : (
              <>
                <ul className="space-y-1 text-sm">{steps.filter((x) => x.key !== "finish").map((x) => <li key={x.key} className={x.done ? "text-ok" : "text-warn"}>{x.done ? "✓" : "•"} {x.label}{x.done ? "" : " (still to do)"}</li>)}</ul>
                <p className="text-sm text-ink-soft">Tax and payout info can be finished later, but you won&apos;t be paid until it&apos;s complete.</p>
                <form action={submitOnboarding}><button type="submit" className={primary}>Submit for approval</button></form>
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
