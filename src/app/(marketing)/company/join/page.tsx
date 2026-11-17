import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createAdminClient, createClient, getUser } from "@/lib/supabase/server";
import { inheritCompanyProfile } from "@/lib/enterprise/inherit-profile";
import { logError } from "@/lib/http/api";
import { Card, Container, Notice } from "@/components/ui/misc";
import { Button, ButtonLink } from "@/components/ui/button";
import { companyRpcError } from "@/lib/enterprise/errors";
import { ROLE_LABELS, type CompanyRole } from "@/lib/enterprise/permissions";

export const metadata: Metadata = { title: "Join your team", robots: { index: false } };

/** An active personal (non-Enterprise) paid subscription. Best effort: any error hides the warning. */
async function hasPersonalPaidPlan(userId: string): Promise<boolean> {
  try {
    const { data } = await createAdminClient().from("subscriptions").select("stripe_subscription_id")
      .eq("user_id", userId).or("plan.is.null,plan.neq.enterprise").in("status", ["active", "trialing", "past_due"]).limit(1);
    return Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}

type Peek = { company_name: string; role: CompanyRole; email_hint: string; expires_at: string; email_matches: boolean };

async function accept(formData: FormData) {
  "use server";
  const token = String(formData.get("token") ?? "");
  const { data: companyId, error } = await (await createClient()).rpc("accept_company_invitation", { p_token: token });
  if (error) redirect(`/company/join?token=${encodeURIComponent(token)}&error=${encodeURIComponent(companyRpcError(error).code)}`);
  // V4.3: start from the company's business profile (blank fields only; the member keeps their own email).
  const user = await getUser();
  if (user && typeof companyId === "string") {
    try { await inheritCompanyProfile(createAdminClient(), { companyId, userId: user.id, email: user.email ?? null }); }
    catch (e) { logError("company.join.inherit", e); }
  }
  redirect("/dashboard?joined=1");
}

/**
 * Invitation landing page. Signing in uses the normal flow (SMS code when enabled, email otherwise);
 * accepting requires the account's verified email to match the invitation, checked in the database.
 */
export default async function JoinCompanyPage({ searchParams }: PageProps<"/company/join">) {
  const sp = await searchParams;
  const token = typeof sp.token === "string" ? sp.token : "";
  const here = `/company/join?token=${encodeURIComponent(token)}`;
  const user = await getUser();
  const { data } = token ? await (await createClient()).rpc("peek_company_invitation", { p_token: token }) : { data: null };
  const inv = (Array.isArray(data) ? data[0] : data) as Peek | undefined;
  const err = typeof sp.error === "string" ? companyRpcError({ message: sp.error }).message : null;
  // Joining never cancels a personal plan. Warn people who pay for their own Unlimited so they don't
  // keep paying for access the company seat already includes.
  const paysPersonally = user && inv ? await hasPersonalPaidPlan(user.id) : false;

  return (
    <Container className="py-14">
      <Card className="mx-auto max-w-lg p-6">
        {!inv ? (
          <>
            <h1 className="text-2xl font-extrabold">This invitation isn&apos;t valid</h1>
            <p className="mt-2 text-ink-soft">It may have expired, been replaced by a newer invitation, or already been used. Ask your company administrator to send a new one.</p>
            <ButtonLink href="/" variant="secondary" className="mt-5">Go to Built2Bid</ButtonLink>
          </>
        ) : (
          <>
            <p className="text-sm font-bold uppercase tracking-wide text-accent-ink">Team invitation</p>
            <h1 className="mt-1 text-2xl font-extrabold">Join {inv.company_name} on Built2Bid</h1>
            <p className="mt-2 text-ink-soft">You&apos;ve been invited as <b>{ROLE_LABELS[inv.role]}</b>. Your company provides your license, so there&apos;s nothing to pay.</p>
            <p className="mt-1 text-sm text-ink-soft">Invitation for {inv.email_hint}, valid until {new Date(inv.expires_at).toLocaleDateString(undefined, { dateStyle: "long" })}.</p>
            {err && <Notice tone="danger" className="mt-4">{err}</Notice>}
            {paysPersonally && (
              <Notice tone="warn" className="mt-4" title="You still have your own paid plan">
                Joining doesn&apos;t cancel your personal Unlimited subscription. Your company seat includes everything it does, so after you join, cancel it in <a className="underline" href="/settings/billing">Subscription settings</a> to avoid paying twice. Your bids and customers stay with you either way.
              </Notice>
            )}
            {!user ? (
              <ButtonLink href={`/login?next=${encodeURIComponent(here)}`} size="lg" className="mt-5 w-full">Sign in or create your account</ButtonLink>
            ) : inv.email_matches ? (
              <form action={accept} className="mt-5">
                <input type="hidden" name="token" value={token} />
                <Button type="submit" size="lg" className="w-full whitespace-normal text-center">Accept and join {inv.company_name}</Button>
              </form>
            ) : (
              <Notice tone="warn" className="mt-4" title="Use the invited email">
                You&apos;re signed in with a different or unverified email. Add and verify the invited address in <a className="underline" href="/settings/account">Account settings</a>, or sign out and sign in with it.
              </Notice>
            )}
            <p className="mt-4 text-xs text-ink-soft">Your business profile starts with the company&apos;s details and logo (anything you already filled in is kept, and you keep your own email). Bids and customers you create as a team member belong to the company. Bids you created before joining stay yours.</p>
          </>
        )}
      </Card>
    </Container>
  );
}
