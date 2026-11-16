"use client";
import { Archive, Camera, Loader2, Sparkles, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { PHOTO_LABELS } from "@/lib/operations/photo-labels";
import { cn } from "@/lib/cn";
import { Button } from "../ui/button";
import { Drawer } from "../projects/task-drawer";

interface Photo {
  id: string; customer_id: string | null; estimate_id: string | null; scope_section_id: string | null; width: number | null; height: number | null;
  taken_on: string | null; caption: string | null; labels: string[] | null; ai_labels: string[] | null; ai_status: string | null; created_at: string;
  archived_at: string | null; url: string | null; thumbUrl: string | null;
}
interface PhotoData { available: boolean; canUpload?: boolean; aiEnabled?: boolean; photos: Photo[] }
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Project or customer photo library (V4.3). Photos are stored privately in Built2Bid only, re-encoded
 * without location data. Uploads never change costs. AI label suggestions run only when turned on and
 * only when someone asks; suggestions stay suggestions until accepted.
 */
export function PhotosPanel({ estimateId, customerId, sections }: { estimateId?: string | null; customerId?: string | null; sections?: { id: string; title: string }[] }) {
  const [data, setData] = useState<PhotoData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [caption, setCaption] = useState("");
  const [takenOn, setTakenOn] = useState(today());
  const [failed, setFailed] = useState<{ name: string; error: string }[]>([]);
  const [open, setOpen] = useState<Photo | null>(null);
  const [secs, setSecs] = useState(sections ?? []);
  const fileRef = useRef<HTMLInputElement>(null);
  const q = estimateId ? `estimateId=${estimateId}` : `customerId=${customerId}`;

  const load = useCallback(async () => {
    const r = await fetch(`/api/photos?${q}`, { cache: "no-store" });
    const d = await r.json().catch(() => null);
    if (!r.ok) { setError(d?.error?.message ?? "We couldn't load photos."); return; }
    setData(d); setError(null);
  }, [q]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- load on mount; state is set after the fetch resolves
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (sections || !estimateId) return;
    void fetch(`/api/estimates/${estimateId}/scope`, { cache: "no-store" }).then((r) => r.json()).then((d) => setSecs(((d?.sections ?? []) as { id: string; title: string }[]).map((s) => ({ id: s.id, title: s.title })))).catch(() => {});
  }, [estimateId, sections]);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = Array.from(files).slice(0, 10);
    const fd = new FormData();
    if (estimateId) fd.set("estimateId", estimateId);
    else if (customerId) fd.set("customerId", customerId);
    if (caption.trim()) fd.set("caption", caption.trim());
    if (takenOn) fd.set("takenOn", takenOn);
    for (const f of list) fd.append("files", f);
    setUploading(true); setFailed([]);
    const r = await fetch("/api/photos", { method: "POST", body: fd });
    const d = await r.json().catch(() => null);
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
    if (!r.ok && !d?.failed) { setError(d?.error?.message ?? "Upload failed."); return; }
    setFailed(d?.failed ?? []);
    if (files.length > 10) setFailed((f) => [...f, { name: `${files.length - 10} more`, error: "Upload up to 10 photos at a time." }]);
    setCaption("");
    void load();
  };

  if (error) return <p className="text-sm text-danger" role="alert">{error}</p>;
  if (!data) return <p className="flex items-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading photos…</p>;
  if (!data.available) return <p className="text-sm text-muted">Photos turn on after the project operations update is installed.</p>;

  return (
    <div className="space-y-4" data-testid="photos-panel">
      {data.canUpload && (
        <section className="rounded-xl border border-line bg-surface p-4">
          <h2 className="font-bold">Add photos</h2>
          <p className="mt-1 text-xs text-muted">Stored privately in Built2Bid. Location data is removed. Up to 10 photos at a time, 10 MB each.</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_10rem_auto]">
            <input aria-label="Caption for these photos" className="field field-sm" placeholder="Caption (optional)" value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={500} />
            <input aria-label="Date taken" type="date" className="field field-sm" value={takenOn} onChange={(e) => setTakenOn(e.target.value)} />
            <Button size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Upload className="h-4 w-4" aria-hidden />} {uploading ? "Uploading…" : "Choose photos"}
            </Button>
          </div>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/*" multiple hidden onChange={(e) => void upload(e.target.files)} data-testid="photo-input" />
          {failed.length > 0 && <ul className="mt-2 text-xs text-danger" role="alert">{failed.map((f, i) => <li key={i}>{f.name}: {f.error}</li>)}</ul>}
        </section>
      )}
      {!data.photos.length ? (
        <p className="flex items-center gap-2 rounded-xl border border-dashed border-line p-6 text-sm text-muted"><Camera className="h-5 w-5" aria-hidden /> No photos yet.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {data.photos.map((p) => (
            <li key={p.id}>
              <button className="group block w-full overflow-hidden rounded-xl border border-line bg-surface text-left" onClick={() => setOpen(p)} aria-label={`Open photo ${p.caption ?? ""}`.trim()}>
                {/* eslint-disable-next-line @next/next/no-img-element -- private signed URLs, already resized */}
                {p.thumbUrl ? <img src={p.thumbUrl} alt={p.caption ?? "Project photo"} className="aspect-[4/3] w-full object-cover" loading="lazy" /> : <div className="aspect-[4/3] bg-paper" />}
                <div className="p-2">
                  <p className="truncate text-xs font-semibold">{p.caption || "No caption"}</p>
                  <p className="text-[11px] text-muted">{p.taken_on ?? p.created_at.slice(0, 10)}{p.labels?.length ? ` · ${p.labels.slice(0, 2).join(", ")}` : ""}</p>
                  {!!p.ai_labels?.length && <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-accent-ink"><Sparkles className="h-3 w-3" aria-hidden />Suggestions to review</p>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && <PhotoDrawer photo={open} canEdit={Boolean(data.canUpload)} aiEnabled={Boolean(data.aiEnabled)} sections={secs} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); void load(); }} />}
    </div>
  );
}

function PhotoDrawer({ photo, canEdit, aiEnabled, sections, onClose, onSaved }: { photo: Photo; canEdit: boolean; aiEnabled: boolean; sections: { id: string; title: string }[]; onClose: () => void; onSaved: () => void }) {
  const [caption, setCaption] = useState(photo.caption ?? "");
  const [takenOn, setTakenOn] = useState(photo.taken_on ?? "");
  const [labels, setLabels] = useState<string[]>(photo.labels ?? []);
  const [suggested, setSuggested] = useState<string[]>((photo.ai_labels ?? []).filter((l) => !(photo.labels ?? []).includes(l)));
  const [section, setSection] = useState(photo.scope_section_id ?? "");
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toggle = (l: string) => setLabels((x) => (x.includes(l) ? x.filter((y) => y !== l) : [...x, l].slice(0, 10)));

  const save = async (extra?: { archived?: boolean }) => {
    setBusy(true); setErr(null);
    const r = await fetch(`/api/photos/${photo.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ caption, takenOn, labels, scopeSectionId: section, ...extra }) });
    const d = await r.json().catch(() => null);
    setBusy(false);
    if (!r.ok) { setErr(d?.error?.message ?? "We couldn't save the photo."); return; }
    onSaved();
  };
  const suggest = async () => {
    setBusy(true); setErr(null);
    const r = await fetch(`/api/photos/${photo.id}/suggest`, { method: "POST" });
    const d = await r.json().catch(() => null);
    setBusy(false);
    if (!r.ok) { setErr(d?.error?.message ?? "No suggestions right now."); return; }
    setSuggested(((d?.labels ?? []) as string[]).filter((l) => !labels.includes(l)));
  };

  return (
    <Drawer open onOpenChange={(o) => { if (!o) onClose(); }} title={photo.caption || "Photo"}>
      <div className="space-y-3" data-testid="photo-drawer">
        {/* eslint-disable-next-line @next/next/no-img-element -- private signed URL */}
        {photo.url && <a href={photo.url} target="_blank" rel="noreferrer"><img src={photo.url} alt={photo.caption ?? "Project photo"} className="w-full rounded-lg border border-line" /></a>}
        <div><label className="label" htmlFor="ph-cap">Caption</label><input id="ph-cap" className="field field-sm" value={caption} disabled={!canEdit} onChange={(e) => setCaption(e.target.value)} maxLength={500} /></div>
        <div><label className="label" htmlFor="ph-date">Date taken</label><input id="ph-date" type="date" className="field field-sm" value={takenOn} disabled={!canEdit} onChange={(e) => setTakenOn(e.target.value)} /></div>
        {sections.length > 0 && (
          <div><label className="label" htmlFor="ph-sec">Scope section</label>
            <select id="ph-sec" className="field field-sm" value={section} disabled={!canEdit} onChange={(e) => setSection(e.target.value)}>
              <option value="">Not linked</option>{sections.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
          </div>
        )}
        <div>
          <p className="label">Labels</p>
          {suggested.length > 0 && (
            <div className="mb-2 rounded-lg bg-accent/10 p-2">
              <p className="mb-1 flex items-center gap-1 text-xs font-semibold"><Sparkles className="h-3 w-3" aria-hidden /> AI suggestions (review before accepting)</p>
              <div className="flex flex-wrap gap-1">{suggested.map((l) => <button key={l} disabled={!canEdit} onClick={() => { toggle(l); setSuggested((s) => s.filter((x) => x !== l)); }} className="rounded-full border border-dashed border-accent-ink px-2 py-0.5 text-xs">+ {l}</button>)}</div>
            </div>
          )}
          <div className="flex flex-wrap gap-1">
            {[...new Set([...labels, ...PHOTO_LABELS])].map((l) => (
              <button key={l} disabled={!canEdit} aria-pressed={labels.includes(l)} onClick={() => toggle(l)} className={cn("rounded-full border px-2 py-0.5 text-xs", labels.includes(l) ? "border-brand bg-brand-tint font-semibold" : "border-line text-muted")}>{l}</button>
            ))}
          </div>
          {canEdit && (
            <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); const v = custom.trim().toLowerCase(); if (v) { if (!labels.includes(v)) toggle(v); setCustom(""); } }}>
              <input aria-label="Add your own label" className="field field-sm" placeholder="Add your own label" value={custom} onChange={(e) => setCustom(e.target.value)} maxLength={40} />
              <Button size="sm" variant="secondary" type="submit">Add</Button>
            </form>
          )}
          {canEdit && aiEnabled && (
            <div className="mt-2">
              <Button size="sm" variant="ghost" onClick={() => void suggest()} disabled={busy}><Sparkles className="h-4 w-4" aria-hidden /> Suggest labels</Button>
              <p className="text-[11px] text-muted">Sends a small preview of this photo to our AI provider (Anthropic) to suggest labels. Nothing is changed until you accept.</p>
            </div>
          )}
        </div>
        {err && <p className="text-sm text-danger" role="alert">{err}</p>}
        {canEdit && (
          <div className="flex flex-wrap justify-between gap-2 pt-2">
            <Button size="sm" variant="ghost" onClick={() => void save({ archived: true })} disabled={busy}><Archive className="h-4 w-4" aria-hidden /> Archive</Button>
            <Button size="sm" onClick={() => void save()} disabled={busy}>Save</Button>
          </div>
        )}
      </div>
    </Drawer>
  );
}
