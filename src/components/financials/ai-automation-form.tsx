"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Notice } from "@/components/ui/misc";
import { finAction } from "./fin-client";

type Key = "photoLabeling" | "expenseSuggestions" | "documentExtraction" | "communicationDrafting";
interface Feature { key: Key; title: string; what: string; sent: string; results: string; status: "live" | "later" }

/** Plain-language disclosure for each toggle: what it does, what's sent, to whom, and who sees the result. */
const FEATURES: Feature[] = [
  { key: "photoLabeling", title: "Photo label suggestions", status: "live",
    what: "When someone taps “Suggest labels” on a project photo, suggests labels like “before” or “roofing”. Nothing is labeled until a person accepts.",
    sent: "One small preview of that photo (location data already removed). No names, prices or customer details.",
    results: "People on your team who can see that project's photos." },
  { key: "expenseSuggestions", title: "Expense category suggestions", status: "later",
    what: "Suggests a job and cost code for an expense. Your past choices are used first; AI only when there's no match. You always confirm.",
    sent: "The vendor name, amount and description of that one expense.",
    results: "The person recording the expense, and anyone who can see job costs." },
  { key: "documentExtraction", title: "Read a receipt or bill", status: "later",
    what: "Drafts vendor, date, amount and lines from an uploaded receipt when you tap “Read receipt”. Every field must be checked before saving.",
    sent: "That one receipt or bill image or PDF.",
    results: "The person uploading it, and anyone who can see job costs." },
  { key: "communicationDrafting", title: "Draft payment messages", status: "later",
    what: "Writes a first draft of a payment reminder or update from your recorded numbers. You review and edit before anything is sent.",
    sent: "The customer's first name, project name, invoice number, amounts and due dates for that message.",
    results: "People who can create invoices or record payments." },
];

/**
 * Company → AI & Automation. Independent toggles, no master switch, nothing turned on behind your back.
 * Financials works fully with every one of these off. Photo label suggestions stay on (today's behavior)
 * until someone turns them off here.
 */
export function AiAutomationForm({ initial, canEdit }: { initial: Record<Key, boolean>; canEdit: boolean }) {
  const router = useRouter();
  const [prefs, setPrefs] = useState(initial);
  const [busy, setBusy] = useState<Key | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const toggle = async (k: Key) => {
    const next = !prefs[k];
    setBusy(k); setMsg(null);
    const r = await finAction({ action: "save_ai_preferences", p: { [k]: next } });
    setBusy(null);
    if (!r.ok) return setMsg({ tone: "danger", text: r.message });
    setPrefs({ ...prefs, [k]: next });
    setMsg({ tone: "ok", text: `${FEATURES.find((f) => f.key === k)!.title} turned ${next ? "on" : "off"}.` });
    router.refresh();
  };
  return (
    <div className="space-y-4" data-testid="fin-ai-form">
      <Notice title="Everything works with AI off">Balances, payments, invoices and reports never depend on AI. Each feature below only runs when someone asks for it.</Notice>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <ul className="space-y-3">
        {FEATURES.map((f) => (
          <li key={f.key} className="rounded-xl border border-line bg-surface p-4">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="font-display text-lg font-extrabold">{f.title}{f.status === "later" && <span className="ml-2 align-middle text-xs font-semibold text-muted">Not built yet: the setting is saved for when it ships</span>}</h2>
                <p className="mt-1 text-sm text-ink-soft">{f.what}</p>
              </div>
              <button type="button" role="switch" aria-checked={prefs[f.key]} aria-label={f.title} disabled={!canEdit || busy !== null} onClick={() => void toggle(f.key)}
                className={`relative inline-flex h-8 w-14 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${prefs[f.key] ? "bg-brand" : "bg-line-strong"}`} data-testid={`fin-ai-${f.key}`}>
                <span className={`inline-block h-6 w-6 rounded-full bg-white shadow transition-transform ${prefs[f.key] ? "translate-x-7" : "translate-x-1"}`} />
              </button>
            </div>
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
              <div><dt className="text-xs font-bold uppercase tracking-wider text-muted">What&apos;s sent</dt><dd>{f.sent}</dd></div>
              <div><dt className="text-xs font-bold uppercase tracking-wider text-muted">Sent to</dt><dd>Anthropic (Claude), through its API. API data isn&apos;t used to train models under Anthropic&apos;s commercial terms.</dd></div>
              <div><dt className="text-xs font-bold uppercase tracking-wider text-muted">Who sees results</dt><dd>{f.results}</dd></div>
            </dl>
            <p className="mt-2 text-xs text-muted">Turn it off here at any time; it stops right away. Nothing already saved is changed.</p>
          </li>
        ))}
      </ul>
      {!canEdit && <p className="text-sm text-muted">Only people who can manage financial settings can change these.</p>}
    </div>
  );
}
