"use client";
import type { Dispatch } from "react";
import type { Estimate } from "@/lib/estimate/types";
import { OUTCOMES, SECTORS, WORK_TYPES, tradeModel, type ProjectProfile } from "@/lib/market/trade-models";
import { tradeName } from "@/lib/trades/catalog";
import { Field } from "../ui/misc";
import type { Action } from "./state";

/**
 * Optional structured project facts. Private to the contractor (never on the proposal). They make
 * the contractor's own records more useful and, only if the contractor opted in to anonymous
 * benchmarking, let a finalized bid be compared with similar projects.
 */
export function ProjectProfileFields({ estimate: e, dispatch }: { estimate: Estimate; dispatch: Dispatch<Action> }) {
  const trade = e.trades[0];
  const model = tradeModel(trade);
  const p: ProjectProfile = e.projectProfile ?? {};
  const m = p.measurements ?? {};
  const set = (patch: Partial<ProjectProfile>) => dispatch({ type: "patch", patch: { projectProfile: { ...p, ...patch } } });
  const setM = (key: string, value: number | string | boolean | undefined) => {
    const next = { ...m };
    if (value === undefined || value === "" || (typeof value === "number" && !Number.isFinite(value))) delete next[key];
    else next[key] = value;
    set({ measurements: next });
  };
  const opt = <T extends string>(v: string): T | undefined => (v ? (v as T) : undefined);

  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <h3 className="font-bold">Project details <span className="font-normal text-muted">(optional, private)</span></h3>
      <p className="mt-1 text-xs text-muted">Not shown on the proposal. Helps you compare your own jobs{trade ? ` and describes this ${tradeName(trade).toLowerCase()} project` : ""}.</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Field label="Sector" htmlFor="pp-sector">
          <select id="pp-sector" className="field" value={p.sector ?? ""} onChange={(ev) => set({ sector: opt(ev.target.value) })}>
            <option value="">Not specified</option>
            {SECTORS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Field>
        <Field label="Type of work" htmlFor="pp-work">
          <select id="pp-work" className="field" value={p.workType ?? ""} onChange={(ev) => set({ workType: opt(ev.target.value) })}>
            <option value="">Not specified</option>
            {WORK_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Field>
        {model.projectTypes.length > 0 && (
          <Field label="Project type" htmlFor="pp-type">
            <select id="pp-type" className="field" value={p.projectType ?? ""} onChange={(ev) => set({ projectType: ev.target.value || undefined })}>
              <option value="">Not specified</option>
              {model.projectTypes.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
        )}
        {model.fields.map((f) => {
          const id = `pp-m-${f.key}`;
          if (f.type === "number") return (
            <Field key={f.key} label={f.unit ? `${f.label} (${f.unit})` : f.label} htmlFor={id}>
              <input id={id} className="field" inputMode="decimal" value={m[f.key] === undefined ? "" : String(m[f.key])}
                onChange={(ev) => setM(f.key, ev.target.value.slice(0, 12) || undefined)} />
            </Field>
          );
          if (f.type === "boolean") return (
            <label key={f.key} className="flex items-center gap-2 self-end pb-2 text-sm">
              <input type="checkbox" className="accent-[var(--color-brand)]" checked={m[f.key] === true} onChange={(ev) => setM(f.key, ev.target.checked ? true : undefined)} /> {f.label}
            </label>
          );
          return (
            <Field key={f.key} label={f.label} htmlFor={id}>
              <select id={id} className="field" value={String(m[f.key] ?? "")} onChange={(ev) => setM(f.key, ev.target.value || undefined)}>
                <option value="">Not specified</option>
                {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
          );
        })}
        <Field label="Bid outcome" htmlFor="pp-outcome" hint="Update this when the customer decides.">
          <select id="pp-outcome" className="field" value={p.outcome ?? ""} onChange={(ev) => set({ outcome: opt(ev.target.value) })}>
            <option value="">Not decided</option>
            {OUTCOMES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Field>
      </div>
    </section>
  );
}
