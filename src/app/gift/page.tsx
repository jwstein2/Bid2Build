import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Gift, Check } from "lucide-react";
import { Logo } from "@/components/layout/logo";
import { ButtonLink } from "@/components/ui/button";
import { Notice } from "@/components/ui/misc";
import { createAdminClient, getUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { giftClaimMessage } from "@/lib/creator/program";
import { giftPath, hashInviteToken, isTokenShape } from "@/lib/creator/server";
import { AcceptGift } from "./accept";

export const metadata: Metadata = { title: "Your Built2Bid membership", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * A creator-gifted Built2Bid Unlimited membership. The gift becomes the subscriber's OWN account and
 * company profile: it's only granted to the signed-in account whose VERIFIED email matches the
 * invitation (enforced in Postgres), and the creator never gets access to their business data.
 */
export default async function GiftPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const token = ((await searchParams).token ?? "").slice(0, 200);
  if (!isSupabaseConfigured()) redirect("/");
  const valid = isTokenShape(token);
  const { data } = valid ? await createAdminClient().rpc("creator_gift_preview", { p_token_hash: hashInviteToken(token) }) : { data: null };
  const preview = (data ?? { ok: false, reason: "invalid" }) as { ok: boolean; reason?: string; workspace_name?: string; channel_name?: string; program_expires_at?: string; email_hint?: string };
  const user = await getUser();
  const until = preview.program_expires_at ? new Date(preview.program_expires_at).toLocaleDateString("en-US", { dateStyle: "long" }) : null;
  const from = preview.channel_name || preview.workspace_name;

  return (
    <main id="main" className="flex min-h-screen items-start justify-center bg-paper px-4 py-10 sm:py-16">
      <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
        <div className="on-dark bg-navy px-6 py-6 text-white sm:px-8">
          <Logo tone="dark" />
          <p className="mt-6 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-sm"><Gift className="h-4 w-4 text-cyan" aria-hidden /> A gift{from ? ` from ${from}` : ""}</p>
          <h1 className="mt-3 font-display text-3xl font-extrabold leading-tight">Built2Bid Unlimited, on us{until ? ` until ${until}` : ""}</h1>
          <p className="mt-2 text-[#C9D6E3]">Estimating and proposal software for your own contracting business.</p>
        </div>
        <div className="space-y-5 px-6 py-6 sm:px-8">
          {!preview.ok ? (
            <Notice tone="warn">{giftClaimMessage(preview.reason)}</Notice>
          ) : (
            <>
              <ul className="space-y-2 text-sm">
                {["Your own branded company account. Your bids, customers and pricing belong to you.", "Unlimited bids, professional PDF proposals, Saved Items & Pricing and Proposal Templates.",
                  "Optional coaching: you choose which bids, if any, to share for feedback, and you can stop anytime.", "No credit card. Nothing is charged when the membership ends; your work stays."].map((t) => (
                  <li key={t} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-teal" aria-hidden />{t}</li>
                ))}
              </ul>
              {user ? (
                <AcceptGift token={token} signedInAs={user.email ?? user.phone ?? "this account"} emailHint={preview.email_hint ?? ""} />
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-ink-soft">This gift was sent to <strong>{preview.email_hint}</strong>. Sign in or create your free account with that email to accept it.</p>
                  <ButtonLink href={`/login?next=${encodeURIComponent(giftPath(token))}`} variant="accent" size="lg" className="w-full">Continue</ButtonLink>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
