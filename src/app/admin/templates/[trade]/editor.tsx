"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/misc";
import { parseTemplateText } from "@/lib/trades/template-schema";
import { saveTemplateVersion, type SaveTemplateResult } from "../../actions";

export function TemplateEditor({ trade, initial }: { trade: string; initial: string }) {
  const [text, setText] = useState(initial);
  const [result, setResult] = useState<SaveTemplateResult | null>(null);
  const [pending, start] = useTransition();
  const check = parseTemplateText(text);
  const save = (publish: boolean) => start(async () => setResult(await saveTemplateVersion(trade, text, publish)));
  return (
    <div className="space-y-3">
      <label htmlFor="tpl" className="label">Template</label>
      <textarea id="tpl" value={text} onChange={(e) => { setText(e.target.value); setResult(null); }} spellCheck={false} rows={28} className="field font-mono text-xs leading-relaxed" aria-describedby="tpl-status" />
      <div id="tpl-status">
        {!check.ok ? <Notice tone="warn" title="Fix before saving"><ul className="list-disc pl-4">{check.errors.slice(0, 8).map((e) => <li key={e}>{e}</li>)}</ul></Notice>
          : <p className="text-xs text-muted">{check.definition.groups.length} sections, {check.definition.groups.reduce((n, g) => n + g.items.length, 0)} suggested items, {check.definition.examples.length} examples.</p>}
        {result?.ok && <Notice tone="ok" className="mt-2" title={`Saved v${result.version}${result.published ? " and published" : " as draft"}`} />}
        {result && !result.ok && <Notice tone="danger" className="mt-2" title="Not saved"><ul className="list-disc pl-4">{result.errors.map((e) => <li key={e}>{e}</li>)}</ul></Notice>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={!check.ok || pending} onClick={() => save(false)}>Save as draft</Button>
        <Button disabled={!check.ok || pending} onClick={() => save(true)}>Save and publish</Button>
      </div>
    </div>
  );
}
