import { Badge, Notice } from "@/components/ui/misc";
import { EMAIL_STATUS_LABEL, isBadEmail, type LeadEmailStatus } from "@/lib/sales/crm";
import { dateLabel } from "@/lib/sales/format";

type L = { id: string; email: string | null; email_status?: LeadEmailStatus | null; email_checked_at?: string | null; email_check_note?: string | null; do_not_contact?: boolean };

/** Small badge for lists: only shown when the email is bad or not yet checked. */
export function EmailStatusBadge({ status }: { status?: string | null }) {
  if (!status || status === "ok") return null;
  return <Badge tone={isBadEmail(status) ? "danger" : "neutral"}>{EMAIL_STATUS_LABEL[status as LeadEmailStatus] ?? status}</Badge>;
}

/**
 * Lead page: can this email receive mail? A warning when it can't (with the reason), otherwise a short
 * status line and a "got a bounce?" button. `action` marks the email bounced; `idField` is the form
 * field the action reads the lead id from.
 */
export function EmailStatusPanel({ lead: l, action, idField = "id", back }: { lead: L; action: (fd: FormData) => Promise<void>; idField?: string; back?: string }) {
  if (!l.email) return null;
  const status = (l.email_status ?? "unchecked") as LeadEmailStatus;
  if (isBadEmail(status)) {
    return (
      <Notice tone="danger" title={status === "bounced" ? "This email bounced" : "This email can't receive mail"}>
        <span className="break-all">{l.email}</span>: {l.email_check_note ?? "The domain has no working mail server."} Don&apos;t email it; reach them by phone, or find a different published address and update the lead.
        {l.email_checked_at && <span className="text-muted"> (checked {dateLabel(l.email_checked_at)})</span>}
      </Notice>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="email-status">
      <span className="text-muted">Email</span> <span className="break-all">{l.email}</span>
      <Badge tone={status === "ok" ? "ok" : "neutral"}>{EMAIL_STATUS_LABEL[status]}</Badge>
      {status === "ok" && l.email_checked_at && <span className="text-xs text-muted">mail server checked {dateLabel(l.email_checked_at)}</span>}
      {status === "unchecked" && <span className="text-xs text-muted">{l.email_check_note ?? "Checked automatically within a day."}</span>}
      <details className="text-sm">
        <summary className="cursor-pointer text-brand underline">Got a bounce?</summary>
        <form action={action} className="mt-2 flex flex-wrap items-end gap-2">
          <input type="hidden" name={idField} value={l.id} />
          {back && <input type="hidden" name="back" value={back} />}
          <label className="text-sm">What the bounce said (optional)<input name="note" maxLength={300} className="min-h-11 w-full rounded-lg border border-line bg-white px-3 text-sm" /></label>
          <button className="min-h-11 rounded-lg border border-danger px-4 text-sm font-semibold text-danger">Mark email bounced</button>
        </form>
      </details>
    </div>
  );
}
