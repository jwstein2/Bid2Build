"use client";
import { useState } from "react";

/** Copy an approved reply to the clipboard so the owner can post it by hand. */
export function CopyButton({ text, label = "Copy response" }: { text: string; label?: string }) {
  const [state, setState] = useState<"idle" | "ok" | "fail">("idle");
  return (
    <button type="button" data-testid="radar-copy"
      className="cc-mono rounded-md border border-[var(--cc-blue)] px-3 py-1.5 text-xs font-semibold text-[var(--cc-blue)] hover:bg-[rgb(56_182_255/0.1)]"
      onClick={() => navigator.clipboard?.writeText(text).then(() => setState("ok"), () => setState("fail"))}>
      {state === "ok" ? "Copied ✓" : state === "fail" ? "Copy failed: select the text" : label}
    </button>
  );
}
