import type { Metadata } from "next";
import { verifyUnsubscribeToken } from "@/lib/creator/outreach/unsubscribe";
import { createAdminClient } from "@/lib/supabase/server";
import { Container } from "@/components/ui/misc";
import { UnsubscribeButton } from "./unsubscribe-button";

export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Opt-out page for creator partnership emails. GET never changes anything (link scanners); the button does. */
export default async function Unsubscribe({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t = "" } = await searchParams;
  const email = verifyUnsubscribeToken(t, process.env.CREATOR_OUTREACH_SECRET ?? "");
  let already = false;
  if (email) {
    const { data } = await createAdminClient().from("creator_outreach_suppressions").select("email").eq("email", email).maybeSingle();
    already = Boolean(data);
  }
  return (
    <Container className="max-w-lg py-16">
      <h1 className="text-2xl font-extrabold text-navy">Built2Bid partnership emails</h1>
      {!email ? (
        <p className="mt-3 text-ink-soft">This unsubscribe link isn&apos;t valid. Reply to the email with &quot;unsubscribe&quot; and we&apos;ll remove you by hand.</p>
      ) : already ? (
        <p className="mt-3 text-ink-soft">You&apos;re unsubscribed. We won&apos;t send partnership emails to this address again.</p>
      ) : (
        <>
          <p className="mt-3 text-ink-soft">Stop all Built2Bid creator partnership emails to this address?</p>
          <UnsubscribeButton token={t} />
        </>
      )}
    </Container>
  );
}
