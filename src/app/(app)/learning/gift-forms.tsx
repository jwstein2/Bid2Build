"use client";
import { useActionState, useState } from "react";
import { Notice } from "@/components/ui/misc";
import { btn, btnSecondary, input } from "@/components/creator/flash";
import { inviteGift, markGiftSent, rotateGift, type LinkResult } from "./actions";

function CopyLink({ link, giftId }: { link: string; giftId?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-2 flex flex-col gap-2 sm:flex-row">
      <input readOnly value={link} aria-label="Private invitation link" className={input} onFocus={(e) => e.currentTarget.select()} />
      <button
        type="button"
        className={btnSecondary}
        onClick={async () => {
          try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setCopied(false); }
          if (giftId) { const f = new FormData(); f.set("giftId", giftId); void markGiftSent(f); }
        }}
      >{copied ? "Copied" : "Copy link"}</button>
    </div>
  );
}

function Result({ state }: { state: LinkResult }) {
  if (!state) return null;
  if (!state.ok) return <Notice tone="danger" className="mt-3">{state.message}</Notice>;
  return (
    <Notice tone="ok" className="mt-3">
      {state.message}
      <CopyLink link={state.link} />
      <span className="mt-2 block text-xs">This link is shown once. If you lose it, use &quot;New link&quot; on their invitation.</span>
    </Notice>
  );
}

export function InviteForm({ programId, seatsLeft, replaces }: { programId: string; seatsLeft: number; replaces?: { id: string; label: string } }) {
  const [state, action, pending] = useActionState(inviteGift, null);
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="programId" value={programId} />
      {replaces && <input type="hidden" name="replaces" value={replaces.id} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-medium">Their email
          <input name="email" type="email" required autoComplete="off" className={input} placeholder="name@company.com" />
        </label>
        <label className="grid gap-1 text-sm font-medium">Name (optional)
          <input name="displayName" maxLength={120} className={input} placeholder="How you know them" />
        </label>
      </div>
      <p className="text-xs text-ink-soft">
        They get their own Built2Bid Unlimited account and company profile until your program ends. They are never added to your company, and you never see their bids unless they choose to share one.
        {replaces ? ` Replaces ${replaces.label}; the membership end date stays the same.` : ""}
      </p>
      <div><button className={btn} disabled={pending || seatsLeft <= 0}>{pending ? "Creating…" : seatsLeft > 0 ? "Create private invitation" : "No gift memberships left"}</button></div>
      <Result state={state} />
    </form>
  );
}

export function RotateButton({ giftId }: { giftId: string }) {
  const [state, action, pending] = useActionState(rotateGift, null);
  return (
    <form action={action}>
      <input type="hidden" name="giftId" value={giftId} />
      <button className="text-sm font-semibold underline disabled:opacity-50" disabled={pending}>{pending ? "Creating…" : "New link"}</button>
      <Result state={state} />
    </form>
  );
}
