"use client";

import { useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Wrap any upload control to let people drag files onto it.
 *
 * The dropped files are handed to the `<input type="file">` inside the wrapper
 * and a normal `change` event fires, so the input's existing onChange handler
 * (type, size and other checks) runs exactly as it does for the file picker,
 * and form posts that read the input pick the files up too. Pass `onFiles` to
 * receive the files directly instead.
 */
export function FileDrop({
  children,
  className,
  onFiles,
  accept,
  multiple,
  disabled,
  label = "Drop file to upload",
  testId,
}: {
  children: ReactNode;
  className?: string;
  /** Receive dropped files directly instead of routing them through the inner input. */
  onFiles?: (files: File[]) => void;
  /** Overrides the inner input's accept attribute when filtering dropped files. */
  accept?: string;
  /** Overrides the inner input's multiple attribute. */
  multiple?: boolean;
  disabled?: boolean;
  /** Text shown over the area while a file is dragged over it. */
  label?: string;
  testId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const depth = useRef(0);
  const [over, setOver] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useFileDropGuard();

  useEffect(() => {
    if (!err) return;
    const t = setTimeout(() => setErr(null), 5000);
    return () => clearTimeout(t);
  }, [err]);

  const input = () => ref.current?.querySelector<HTMLInputElement>('input[type="file"]') ?? null;
  const inactive = () => disabled || (!onFiles && (input()?.disabled ?? true));

  const onDragEnter = (e: DragEvent) => {
    if (!hasFiles(e) || inactive()) return;
    e.preventDefault();
    depth.current += 1;
    setOver(true);
  };
  const onDragOver = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = inactive() ? "none" : "copy";
  };
  const onDragLeave = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setOver(false);
  };
  const onDrop = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    depth.current = 0;
    setOver(false);
    if (inactive()) return;
    const el = input();
    const result = pickDroppedFiles(Array.from(e.dataTransfer.files), accept ?? el?.accept ?? "", multiple ?? el?.multiple ?? false);
    if (result.error) { setErr(result.error); return; }
    setErr(null);
    if (onFiles) { onFiles(result.files); return; }
    if (!el) return;
    const dt = new DataTransfer();
    for (const f of result.files) dt.items.add(f);
    el.files = dt.files;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };

  return (
    <div
      ref={ref}
      className={cn("relative", className)}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      data-file-drop=""
      data-drag-over={over ? "true" : undefined}
      data-testid={testId}
    >
      {children}
      {over && (
        <div aria-hidden className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-[inherit] border-2 border-dashed border-focus bg-brand-tint/90 p-2 text-center text-sm font-semibold text-brand">
          {label}
        </div>
      )}
      {err && <p role="alert" className="mt-1 text-xs text-danger">{err}</p>}
    </div>
  );
}

function hasFiles(e: DragEvent) {
  return Array.from(e.dataTransfer?.types ?? []).includes("Files");
}

/** Filter dropped files against an input's accept list and multiple flag. Pure, for tests. */
export function pickDroppedFiles(files: File[] | { name: string; type: string }[], accept: string, multiple: boolean): { files: File[]; error: string | null } {
  if (files.length === 0) return { files: [], error: null };
  const ok = files.filter((f) => matchesAccept(f, accept)) as File[];
  if (ok.length === 0) return { files: [], error: files.length > 1 ? "Those file types can't be uploaded here." : "That file type can't be uploaded here." };
  return { files: multiple ? ok : ok.slice(0, 1), error: null };
}

export function matchesAccept(file: { name: string; type: string }, accept: string): boolean {
  const rules = accept.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (rules.length === 0) return true;
  const name = file.name.toLowerCase();
  const type = (file.type || "").toLowerCase();
  return rules.some((r) => {
    if (r.startsWith(".")) return name.endsWith(r);
    if (r.endsWith("/*")) return type.startsWith(r.slice(0, -1));
    return type === r;
  });
}

let guardUsers = 0;
const stop = (e: Event) => {
  const de = e as globalThis.DragEvent;
  if (!Array.from(de.dataTransfer?.types ?? []).includes("Files")) return;
  // Let real file inputs and drop zones handle their own drops.
  const t = e.target as Element | null;
  if (t?.closest?.('[data-file-drop], input[type="file"]')) return;
  e.preventDefault();
  if (de.dataTransfer) de.dataTransfer.dropEffect = "none";
};

/** While any drop zone is on screen, a file dropped beside it won't make the browser open the file and leave the page. */
function useFileDropGuard() {
  useEffect(() => {
    if (guardUsers++ === 0) { window.addEventListener("dragover", stop); window.addEventListener("drop", stop); }
    return () => {
      if (--guardUsers === 0) { window.removeEventListener("dragover", stop); window.removeEventListener("drop", stop); }
    };
  }, []);
}
