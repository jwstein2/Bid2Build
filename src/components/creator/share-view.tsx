import { Badge, Card, Notice } from "@/components/ui/misc";
import { btn, fmtDate, input } from "./flash";

export type ShareViewData = {
  id: string; program_id: string; workspace_name: string; viewer: "creator" | "participant"; revoked: boolean;
  permissions: { proposal: boolean; costs: boolean; margin: boolean; project_info: boolean; comments: boolean; suggestions: boolean };
  business_name: string | null; trades: string[] | null;
  project: { title: string | null; estimate_date: string | null; city: string | null; state: string | null; pipeline_stage: string | null } | null;
  totals: { subtotal?: string | number; tax?: string | number; total?: string | number; adjustment?: string | number } | null;
  pricing: { mode: string; percent: number | string | null; fixed_adjustment: number | string | null; tax_rate: number | string | null } | null;
  sections: { name: string; description: string | null; pricing: { mode: string; percent: number | string } | null;
    items: { id: string; name: string; description: string | null; unit: string | null; on_proposal: boolean; quantity?: number | string; unit_cost?: number | string; cost_type?: string; treatment?: string; pricing?: { mode: string; percent: number | string } }[] }[];
  comments: { id: string; kind: "comment" | "suggestion"; body: string; created_at: string; resolved_at: string | null; from: "creator" | "participant" | "other" }[];
};

const money = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : Number(v).toLocaleString("en-US", { style: "currency", currency: "USD" }));
const pct = (r: { mode: string; percent: number | string | null } | null | undefined) => (r ? `${r.mode} ${r.percent ?? 0}%` : "");

/**
 * Read-only, already-redacted view of a shared bid. The server function decides every field present;
 * this component only renders what it was given. Never an edit surface.
 */
export function ShareView({ data, commentAction, resolveAction, returnTo }: {
  data: ShareViewData;
  commentAction: (f: FormData) => Promise<void>;
  resolveAction?: (f: FormData) => Promise<void>;
  returnTo: string;
}) {
  const isCreator = data.viewer === "creator";
  const canComment = !data.revoked && (isCreator ? data.permissions.comments || data.permissions.suggestions : true);
  return (
    <div className="grid gap-4">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-ink-soft">{data.workspace_name} · shared bid</p>
        <h1 className="text-2xl font-extrabold">{data.project?.title ?? "Bid (project details not shared)"}</h1>
        <p className="text-sm text-ink-soft">{data.business_name ?? ""}{data.trades?.length ? ` · ${data.trades.join(", ")}` : ""}{data.project ? ` · ${[data.project.city, data.project.state].filter(Boolean).join(", ")} · ${fmtDate(data.project.estimate_date)}` : ""}</p>
        <p className="mt-2 flex flex-wrap gap-1"><Badge>Proposal</Badge>{data.permissions.costs && <Badge>Costs</Badge>}{data.permissions.margin && <Badge>Margin</Badge>}{data.permissions.project_info && <Badge>Project info</Badge>}</p>
      </div>
      {data.revoked && <Notice tone="warn">Sharing for this bid has been turned off.</Notice>}
      {isCreator && <Notice>Customer names and contact details are never shared. Suggestions are notes only; nothing you write changes this bid.</Notice>}

      <Card className="grid gap-2 p-4 sm:grid-cols-4">
        <div><p className="text-xs text-ink-soft">Subtotal</p><p className="font-bold">{money(data.totals?.subtotal)}</p></div>
        <div><p className="text-xs text-ink-soft">Tax</p><p className="font-bold">{money(data.totals?.tax)}</p></div>
        <div><p className="text-xs text-ink-soft">Total</p><p className="text-lg font-extrabold">{money(data.totals?.total)}</p></div>
        {data.pricing && <div><p className="text-xs text-ink-soft">Pricing</p><p className="text-sm font-semibold">{pct(data.pricing)}{Number(data.pricing.fixed_adjustment) ? ` · adj ${money(data.pricing.fixed_adjustment)}` : ""} · tax {data.pricing.tax_rate ?? 0}%</p></div>}
      </Card>

      {data.sections.map((s, i) => (
        <Card key={i} className="overflow-x-auto p-0">
          <div className="border-b border-line p-3"><p className="font-bold">{s.name}{s.pricing ? <span className="ml-2 text-xs font-normal text-ink-soft">{pct(s.pricing)}</span> : null}</p>{s.description && <p className="text-sm text-ink-soft">{s.description}</p>}</div>
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="text-xs uppercase text-ink-soft"><tr><th className="p-2">Item</th>{data.permissions.costs && <><th className="p-2">Qty</th><th className="p-2">Unit cost</th><th className="p-2">Type</th></>}{data.permissions.margin && <th className="p-2">Pricing</th>}</tr></thead>
            <tbody>
              {s.items.map((it) => (
                <tr key={it.id} className="border-t border-line align-top">
                  <td className="p-2"><p className="font-medium">{it.name}{!it.on_proposal && <span className="ml-2"><Badge tone="warn">internal</Badge></span>}</p>{it.description && <p className="text-xs text-ink-soft">{it.description}</p>}</td>
                  {data.permissions.costs && <><td className="p-2">{it.quantity ?? "—"} {it.unit ?? ""}</td><td className="p-2">{money(it.unit_cost)}</td><td className="p-2">{it.cost_type ?? ""}{it.treatment === "pass_through" ? " · pass-through" : ""}</td></>}
                  {data.permissions.margin && <td className="p-2">{pct(it.pricing)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}

      <Card className="p-4">
        <h2 className="font-bold">Coaching notes</h2>
        {data.comments.length === 0 && <p className="mt-2 text-sm text-ink-soft">No notes yet.</p>}
        <ul className="mt-2 grid gap-3">
          {data.comments.map((c) => (
            <li key={c.id} className={`rounded-md border p-3 ${c.kind === "suggestion" ? "border-accent bg-accent-tint" : "border-line"}`}>
              <p className="text-xs text-ink-soft">{c.from === "creator" ? "Mentor" : c.from === "participant" ? (isCreator ? "Participant" : "You") : "Note"} · {c.kind === "suggestion" ? "Suggestion" : "Comment"} · {fmtDate(c.created_at, true)}{c.resolved_at ? " · handled" : ""}</p>
              <p className="mt-1 whitespace-pre-wrap text-sm">{c.body}</p>
              {resolveAction && !c.resolved_at && c.from === "creator" && (
                <form action={resolveAction} className="mt-2"><input type="hidden" name="commentId" value={c.id} /><input type="hidden" name="returnTo" value={returnTo} /><button className="text-xs font-semibold underline">Mark handled</button></form>
              )}
            </li>
          ))}
        </ul>
        {canComment ? (
          <form action={commentAction} className="mt-4 grid gap-2">
            <input type="hidden" name="shareId" value={data.id} />
            <input type="hidden" name="returnTo" value={returnTo} />
            {isCreator ? (
              <select name="kind" className={input} defaultValue={data.permissions.comments ? "comment" : "suggestion"}>
                {data.permissions.comments && <option value="comment">Coaching comment</option>}
                {data.permissions.suggestions && <option value="suggestion">Edit suggestion (a note; doesn&apos;t change the bid)</option>}
              </select>
            ) : <input type="hidden" name="kind" value="comment" />}
            <textarea name="body" required maxLength={4000} rows={3} className={input} placeholder={isCreator ? "What would you change, and why?" : "Reply to your mentor"} />
            <div><button className={btn}>Post</button></div>
          </form>
        ) : isCreator && !data.revoked ? <p className="mt-3 text-sm text-ink-soft">This participant hasn&apos;t turned on comments or suggestions.</p> : null}
      </Card>
    </div>
  );
}
