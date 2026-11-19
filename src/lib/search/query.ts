/**
 * Universal search: turn what the user typed into a deterministic search request.
 *
 * Contractor words are understood without guessing at accounting meaning:
 *   bid / estimate / quote / proposal  -> bids (and signed proposals)
 *   job / project                      -> projects
 *   sub / subcontractor / crew / employee -> people & subs
 *   bill / vendor invoice              -> vendor bills (never customer invoices)
 *   invoice                            -> customer invoices (never vendor bills)
 *   customer payment / receipt         -> customer payments
 * Status words ("overdue", "unpaid", "draft", "won" ...) become real status filters, so "overdue Johnson" finds
 * Johnson's overdue invoices from the computed balance and due date rather than from text that says "overdue".
 * Numbers, money and phone numbers are normalised so "#1042", "$1,250.00" and "(612) 555-0142" match.
 */
import type { SearchKind } from "./kinds";

export interface ParsedQuery {
  /** Cleaned text sent to the database (intent words removed). */
  text: string;
  /** Kinds the query hinted at: ranked higher, never hidden. */
  boost: SearchKind[];
  /** Restrict to these kinds (a status word or a bare type word with no other text); null = everything. */
  types: SearchKind[] | null;
  /** Status filter (comma list of status keys). */
  status: string | null;
  /** Human labels of what was understood, shown as chips ("Invoices", "Overdue"). */
  understood: string[];
  /** The raw input (lowercased, trimmed), used to match command actions. */
  raw: string;
}

type Intent = { words: string[]; kinds: SearchKind[]; label: string };
// Multi-word phrases first so "change order" / "vendor invoice" win over "order" / "invoice".
const INTENTS: Intent[] = [
  { words: ["change orders", "change order", "change-order", "co"], kinds: ["change_order"], label: "Change orders" },
  { words: ["vendor invoices", "vendor invoice", "vendor bills", "vendor bill", "bills", "bill"], kinds: ["bill"], label: "Vendor bills" },
  { words: ["customer payments", "customer payment", "payments", "payment", "receipts", "receipt"], kinds: ["payment"], label: "Customer payments" },
  { words: ["invoices", "invoice", "inv"], kinds: ["invoice"], label: "Invoices" },
  { words: ["signed proposals", "signed proposal", "proposals", "proposal"], kinds: ["signature", "estimate"], label: "Proposals" },
  { words: ["estimates", "estimate", "bids", "bid", "quotes", "quote"], kinds: ["estimate"], label: "Bids & estimates" },
  { words: ["projects", "project", "jobs", "job"], kinds: ["project"], label: "Projects" },
  { words: ["subcontractors", "subcontractor", "subs", "sub", "crews", "crew", "employees", "employee", "staff"], kinds: ["resource"], label: "Team & subs" },
  { words: ["suppliers", "supplier", "vendors", "vendor"], kinds: ["supplier", "vendor"], label: "Suppliers & vendors" },
  { words: ["expenses", "expense"], kinds: ["expense"], label: "Expenses" },
  { words: ["tasks", "task"], kinds: ["task"], label: "Tasks" },
  { words: ["customers", "customer", "clients", "client"], kinds: ["customer"], label: "Customers" },
  { words: ["photos", "photo", "pictures", "picture", "pics"], kinds: ["photo"], label: "Photos" },
  { words: ["saved items", "saved item", "skus", "sku", "products", "product", "items", "item"], kinds: ["saved_item"], label: "Saved Items" },
  { words: ["assemblies", "assembly"], kinds: ["assembly"], label: "Assemblies" },
  { words: ["trade scope", "scopes", "scope"], kinds: ["scope"], label: "Trade scope" },
  { words: ["messages", "message", "emails", "email"], kinds: ["message"], label: "Messages" },
];

type StatusWord = { words: string[]; status: string; kinds: SearchKind[]; label: string };
const STATUSES: StatusWord[] = [
  { words: ["past due", "overdue", "late"], status: "overdue", kinds: ["invoice"], label: "Overdue" },
  { words: ["unpaid", "outstanding"], status: "open,overdue", kinds: ["invoice"], label: "Unpaid" },
  { words: ["paid"], status: "paid", kinds: ["invoice"], label: "Paid" },
  { words: ["needs approval", "pending approval", "unapproved"], status: "pending_approval,pending", kinds: ["bill", "expense"], label: "Needs approval" },
  { words: ["in progress"], status: "in_progress", kinds: ["project", "task", "estimate"], label: "In progress" },
  { words: ["drafts", "draft"], status: "draft", kinds: ["estimate", "invoice", "change_order"], label: "Draft" },
  { words: ["won"], status: "won", kinds: ["estimate", "project"], label: "Won" },
  { words: ["lost"], status: "lost", kinds: ["estimate"], label: "Lost" },
  { words: ["scheduled"], status: "scheduled", kinds: ["estimate", "project"], label: "Scheduled" },
  { words: ["completed"], status: "completed", kinds: ["estimate", "project"], label: "Completed" },
  { words: ["voided", "void"], status: "void", kinds: ["invoice", "bill", "expense", "change_order", "payment"], label: "Void" },
];

const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
const phrase = (w: string) => new RegExp(`(^|\\s)${esc(w)}(?=\\s|$)`, "g");

/** Normalise numbers people type: "#1042" -> "1042", "$1,250.00" -> "1250.00", "(612) 555-0142" -> "6125550142". */
export function normalise(input: string): string {
  let s = ` ${input.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"')} `;
  // Phone numbers (US-style), before punctuation is stripped.
  s = s.replace(/(\+?1[\s.-]?)?\(?(\d{3})\)?[\s.-]?(\d{3})[\s.-](\d{4})(?=\s|$)/g, (_m, _c, a: string, b: string, c: string) => ` ${a}${b}${c} `);
  // Money: $1,250.00 / 1,250
  s = s.replace(/\$\s?(\d[\d,]*(?:\.\d{1,2})?)/g, (_m, n: string) => ` ${n.replace(/,/g, "")} `);
  s = s.replace(/(^|\s)(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?)(?=\s|$)/g, (_m, p: string, n: string) => `${p}${n.replace(/,/g, "")}`);
  // "#1042" / "no. 12"
  s = s.replace(/(^|\s)#\s?(\w)/g, "$1$2");
  // Keep letters, digits and the characters identifiers use (- . / @ & ' _); everything else is a space.
  s = s.replace(/[^\p{L}\p{N}\-./@&'_\s]/gu, " ").replace(/(^|\s)[-./]+|[-./]+(?=\s|$)/g, " ");
  return s.replace(/\s+/g, " ").trim();
}

export function parseQuery(input: string): ParsedQuery {
  const raw = input.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 100);
  let s = ` ${normalise(raw)} `;
  const boost = new Set<SearchKind>();
  const understood: string[] = [];
  let status: StatusWord | null = null;
  for (const st of STATUSES) {
    for (const w of st.words) {
      if (phrase(w).test(s)) { if (!status) status = st; s = s.replace(phrase(w), " "); }
    }
  }
  const typed = new Set<SearchKind>();
  for (const it of INTENTS) {
    for (const w of it.words) {
      if (!phrase(w).test(s)) continue;
      // "co" only counts as "change order" next to a number ("co 2", "co #2").
      if (w === "co" && !/(^|\s)co\s+\d+(\s|$)/.test(s)) continue;
      s = s.replace(phrase(w), " ");
      it.kinds.forEach((k) => { boost.add(k); typed.add(k); });
      if (!understood.includes(it.label)) understood.push(it.label);
    }
  }
  const text = s.replace(/\s+/g, " ").trim();
  let types: SearchKind[] | null = null;
  if (status) {
    understood.push(status.label);
    // A status word narrows to the kinds it applies to (intersected with any type word).
    const allowed = typed.size ? status.kinds.filter((k) => typed.has(k)) : status.kinds;
    types = allowed.length ? allowed : [...typed];
    if (!typed.size) status.kinds.forEach((k) => boost.add(k));
  } else if (!text && typed.size) {
    types = [...typed];   // "invoices" on its own lists recent invoices
  }
  return { text, boost: [...boost], types, status: status?.status ?? null, understood, raw };
}

/** The words to highlight in results (display only). Safe to call on the server and in the browser. */
export const queryWords = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
