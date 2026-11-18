import { Fragment, type ReactNode } from "react";

/**
 * Minimal, safe Markdown for Academy lesson bodies (written by staff): paragraphs, ### headings, "- " and "1. "
 * lists and **bold**. Everything is rendered as React text, so no HTML from the content ever reaches the page.
 */
function inline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => (p.startsWith("**") && p.endsWith("**") ? <strong key={i} className="font-semibold text-ink">{p.slice(2, -2)}</strong> : <Fragment key={i}>{p}</Fragment>));
}

export function Markdown({ source, className }: { source: string; className?: string }) {
  const blocks = source.replace(/\r\n/g, "\n").split(/\n{2,}/);
  return (
    <div className={className}>
      {blocks.map((block, i) => {
        const lines = block.split("\n");
        const heading = lines[0].match(/^#{2,4}\s+(.*)$/);
        if (heading) {
          const rest = lines.slice(1).join("\n").trim();
          return (
            <Fragment key={i}>
              <h3 className="mt-7 font-display text-lg font-bold text-ink">{heading[1]}</h3>
              {rest && <Markdown source={rest} />}
            </Fragment>
          );
        }
        if (lines.every((l) => /^\s*-\s+/.test(l))) {
          return <ul key={i} className="mt-3 list-disc space-y-1.5 pl-5">{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*-\s+/, ""))}</li>)}</ul>;
        }
        if (lines.every((l) => /^\s*\d+\.\s+/.test(l))) {
          return <ol key={i} className="mt-3 list-decimal space-y-1.5 pl-5">{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*\d+\.\s+/, ""))}</li>)}</ol>;
        }
        // A paragraph followed directly by a list ("Some intro:\n- a\n- b").
        const firstList = lines.findIndex((l) => /^\s*(-|\d+\.)\s+/.test(l));
        if (firstList > 0) {
          return <Fragment key={i}><p className="mt-3">{inline(lines.slice(0, firstList).join(" "))}</p><Markdown source={lines.slice(firstList).join("\n")} /></Fragment>;
        }
        return <p key={i} className="mt-3">{inline(lines.join(" "))}</p>;
      })}
    </div>
  );
}

/** Plain-text excerpt of lesson Markdown (for meta descriptions and structured data). */
export function markdownText(source: string, max = 300): string {
  const t = source.replace(/^#{2,4}\s+/gm, "").replace(/\*\*/g, "").replace(/^\s*(-|\d+\.)\s+/gm, "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).replace(/\s+\S*$/, "")}…` : t;
}
