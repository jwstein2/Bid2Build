import type { Metadata } from "next";
import { createClient, getUser } from "@/lib/supabase/server";
import { Card } from "@/components/ui/misc";
import { AccountActions } from "./actions-client";

export const metadata: Metadata = { title: "Account settings", robots: { index: false } };

export default async function AccountPage() {
  const user = (await getUser())!;
  const { data: profile } = await (await createClient()).from("profiles").select("marketing_opt_in").eq("id", user.id).maybeSingle();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-3xl font-extrabold">Account settings</h1>
      <Card className="p-5">
        <p className="text-sm text-muted">Sign-in email</p>
        <p className="font-semibold">{user.email}</p>
        <p className="mt-1 text-sm text-ink-soft">{user.emailVerified ? "Verified" : "Not verified yet: check your inbox."} You sign in with a one-time email link or code; there is no password to manage.</p>
      </Card>
      <AccountActions marketing={Boolean(profile?.marketing_opt_in)} />
    </div>
  );
}
