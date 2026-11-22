import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { fmtDate } from "@/components/academy/kb/parts";
import { partUrl, sectionUrl, type CodebookNode, type CodebookPart } from "@/lib/academy/kb/codebook";

/** Expandable Title → Part → Subpart → Section tree for one codebook part (server component). */
export function PartTree({ part, verified }: { part: CodebookPart; verified: Map<string, string> }) {
  const groups = (part.node.children ?? []).filter((c) => c.t !== "section" || !c.reserved);
  return (
    <div className="mt-5">
      <p className="text-xs text-muted">{part.path.map((x) => `${x.label.trim()}${x.desc ? `: ${x.desc}` : ""}`).join(" › ")}</p>
      <p className="mt-1 flex flex-wrap gap-3 text-sm">
        <a href={partUrl(part)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-brand hover:underline">Whole part on eCFR<ExternalLink className="h-3 w-3" aria-hidden /></a>
        <span className="text-xs text-muted self-center">Current as of {fmtDate(part.as_of)}{part.last_amended ? ` · last amended ${fmtDate(part.last_amended)}` : ""}</span>
      </p>
      <div className="mt-4 space-y-2" data-testid="cb-tree">
        {groups.map((g) => <Node key={`${g.t}-${g.id}-${g.label}`} n={g} part={part} verified={verified} />)}
      </div>
    </div>
  );
}

function Node({ n, part, verified }: { n: CodebookNode; part: CodebookPart; verified: Map<string, string> }) {
  if (n.t === "section") return <SectionRow n={n} part={part} verified={verified} />;
  if (n.t === "appendix") return <li className="px-4 py-3 text-sm text-ink-soft">{n.label}</li>;
  const kids = (n.children ?? []).filter((c) => !c.reserved);
  if (!kids.length) return null;
  const held = kids.filter((c) => c.t === "section" && verified.has(`${part.title} CFR ${c.id}`)).length;
  return (
    <details className="rounded-xl border border-line bg-surface" data-testid="cb-group">
      <summary className="flex min-h-12 cursor-pointer flex-wrap items-center gap-x-2 px-4 py-3">
        <span className="font-semibold">{n.label}{n.desc ? `: ${n.desc}` : ""}</span>
        <span className="text-xs text-muted">{kids.length} {kids.length === 1 ? "item" : "items"}{held ? ` · ${held} with verified text` : ""}</span>
      </summary>
      <ul className="divide-y divide-line border-t border-line">
        {kids.map((c) => (c.t === "section" || c.t === "appendix" ? <Node key={`${c.t}-${c.id}-${c.label}`} n={c} part={part} verified={verified} /> : <li key={`${c.t}-${c.id}-${c.label}`} className="p-2"><Node n={c} part={part} verified={verified} /></li>))}
      </ul>
    </details>
  );
}

function SectionRow({ n, part, verified }: { n: CodebookNode; part: CodebookPart; verified: Map<string, string> }) {
  const cite = `${part.title} CFR ${n.id}`;
  const local = verified.get(cite);
  return (
    <li id={`s-${n.id}`} className="scroll-mt-24 px-4 py-3 text-sm target:bg-accent-tint" data-testid="cb-section">
      <p><span className="font-semibold">§ {n.id}</span> {n.label.replace(/\.$/, "")}</p>
      <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {local && <Link href={`/academy/codes/section/${local}`} className="font-semibold text-ok hover:underline" data-testid="cb-verified">Verified text on Built2Bid</Link>}
        <a href={sectionUrl(part.title, n.id)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-brand hover:underline">Official text<ExternalLink className="h-3 w-3" aria-hidden /></a>
        <Link href={`/academy/codes?q=${encodeURIComponent(cite)}`} className="text-brand hover:underline">Search this section</Link>
      </p>
    </li>
  );
}
