"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/misc";
import { acceptGift } from "./actions";

export function AcceptGift({ token, signedInAs, emailHint }: { token: string; signedInAs: string; emailHint: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      {error && <Notice tone="warn">{error}</Notice>}
      <Button loading={pending} variant="accent" size="lg" className="w-full" disabled={pending} onClick={() => start(async () => {
        setError(null);
        const r = await acceptGift(token);
        if (r.ok) router.push("/welcome"); else setError(r.message);
      })}>{pending ? "Activating your membership…" : "Accept my membership"}</Button>
      <form action="/auth/signout" method="post" className="text-center text-xs text-muted">
        Signed in as {signedInAs}{emailHint ? ` · gift sent to ${emailHint}` : ""}. <button className="underline">Use a different account</button>
      </form>
    </div>
  );
}
