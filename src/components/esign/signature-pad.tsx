"use client";
import { Eraser } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";

/** Pointer-events signature pad (mouse, touch, pen). Exports a trimmed-size PNG data URL. */
export function SignaturePad({ onChange, invalid, id = "sf-signatureImage" }: { onChange: (png: string | null) => void; invalid: boolean; id?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const strokes = useRef(0);
  const last = useRef<{ x: number; y: number } | null>(null);

  const setup = useCallback(() => {
    const c = canvas.current;
    if (!c) return;
    const ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const { width, height } = c.getBoundingClientRect();
    c.width = Math.round(width * ratio); c.height = Math.round(height * ratio);
    const ctx = c.getContext("2d")!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#0e2238";
    strokes.current = 0; onChange(null);
  }, [onChange]);
  useEffect(() => { setup(); }, [setup]);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const finish = () => {
    if (!drawing.current) return;
    drawing.current = false; last.current = null;
    if (strokes.current >= 8 && canvas.current) onChange(exportPng(canvas.current));
  };

  return (
    <div>
      <canvas
        id={id}
        ref={canvas}
        tabIndex={0}
        role="img"
        aria-label="Signature drawing area. Draw your signature with a finger, stylus or mouse."
        className={`block h-40 w-full touch-none rounded-lg border-2 border-dashed bg-white ${invalid ? "border-danger" : "border-line-strong"}`}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); drawing.current = true; last.current = pos(e); }}
        onPointerMove={(e) => {
          if (!drawing.current || !last.current) return;
          const p = pos(e), ctx = e.currentTarget.getContext("2d")!;
          ctx.beginPath(); ctx.moveTo(last.current.x, last.current.y); ctx.lineTo(p.x, p.y); ctx.stroke();
          last.current = p; strokes.current++;
        }}
        onPointerUp={finish}
        onPointerCancel={finish}
        onPointerLeave={finish}
      />
      <button type="button" onClick={setup} className="mt-2 inline-flex min-h-10 items-center gap-1.5 rounded-md px-3 text-sm font-semibold text-navy hover:bg-black/5">
        <Eraser className="h-4 w-4" aria-hidden /> Clear
      </button>
    </div>
  );
}

/** Copy onto a white, max-800px-wide canvas so the stored PNG stays small. */
function exportPng(src: HTMLCanvasElement): string {
  const scale = Math.min(1, 800 / src.width);
  const out = document.createElement("canvas");
  out.width = Math.max(50, Math.round(src.width * scale)); out.height = Math.max(20, Math.round(src.height * scale));
  const ctx = out.getContext("2d")!;
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(src, 0, 0, out.width, out.height);
  return out.toDataURL("image/png");
}
