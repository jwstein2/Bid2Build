import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/server";
import { verifyUnsubscribeToken } from "@/lib/sales/nurture/tokens";
import { Container } from "@/components/ui/misc";
import { SalesUnsubscribeButton } from "./unsubscribe-button";

export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Opt-out page for Built2Bid sales emails. GET never changes anything (link scanners); the button does. */
export default async function Unsubscribe({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t = "" } = await searchParams;
  const email = verifyUnsubscribeToken(t);
  let already = false;
  if (email) {
    const { data } = await createAdminClient().from("sales_suppressions").select("key").eq("key", `e:${email}`).maybeSingle();
    already = Boolean(data);
  }
  return (
    <Container className="max-w-lg py-16">
      <h1 className="text-2xl font-extrabold text-navy">Built2Bid sales emails</h1>
      {!email ? (
        <p className="mt-3 text-ink-soft">This unsubscribe link isn&apos;t valid. Reply to the email with &quot;unsubscribe&quot; and we&apos;ll remove you by hand.</p>
      ) : already ? (
        <p className="mt-3 text-ink-soft">You&apos;re unsubscribed. Our sales team won&apos;t email this address again.</p>
      ) : (
        <>
          <p className="mt-3 text-ink-soft">Stop all Built2Bid sales emails to this address? This applies to everyone on our sales team.</p>
          <SalesUnsubscribeButton token={t} />
          <p className="mt-6 text-xs text-muted">If you have a Built2Bid account, this doesn&apos;t change sign-in codes or emails about your account.</p>
        </>
      )}
    </Container>
  );
}
