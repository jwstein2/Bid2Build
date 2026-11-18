import Link from "next/link";
import { Container, Notice } from "@/components/ui/misc";
import { buttonClass } from "@/components/ui/button";
import type { AcademyMe } from "@/lib/academy/server";

/** Shown on member-only Academy pages (Members, Leaderboard, Saved, Settings) to visitors who haven't joined. */
export function MembersOnly({ me, migrated, what }: { me: AcademyMe; migrated: boolean; what: string }) {
  return (
    <Container className="py-8">
      <div className="max-w-2xl" data-testid="members-only">
        {!migrated ? (
          <Notice title="The community is being set up">{what} opens once setup is finished. The <Link href="/academy/classroom" className="font-semibold underline">Classroom</Link> is open now.</Notice>
        ) : me.status === "banned" ? (
          <Notice tone="warn" title="Your Academy access has been removed">Your Built2Bid account is unaffected. Contact support if you think this is a mistake.</Notice>
        ) : (
          <>
            <Notice title={`${what} is for Academy members`}>Membership is free for anyone with a Built2Bid account. Members choose what others can see about them.</Notice>
            <Link href={me.signed_in ? "/academy/join" : "/login?next=/academy/join"} className={buttonClass("accent", "md", "mt-4")}>Join free</Link>
          </>
        )}
      </div>
    </Container>
  );
}
