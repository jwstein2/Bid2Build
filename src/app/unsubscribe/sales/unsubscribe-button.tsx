"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function SalesUnsubscribeButton({ token }: { token: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  if (state === "done") return <p role="status" className="mt-4 font-semibold text-ok">Done. You won&apos;t hear from us again.</p>;
  return (
    <div className="mt-4">
      <Button disabled={state === "busy"} onClick={async () => {
        setState("busy");
        const r = await fetch("/api/sales/unsubscribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: token }) }).catch(() => null);
        setState(r?.ok ? "done" : "error");
      }}>Unsubscribe</Button>
      {state === "error" && <p role="alert" className="mt-2 text-sm text-danger">That didn&apos;t work. Reply &quot;unsubscribe&quot; to the email instead.</p>}
    </div>
  );
}
