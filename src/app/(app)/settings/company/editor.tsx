"use client";
import { useEffect, useRef, useState } from "react";
import { CompanyStep } from "@/components/builder/company-step";
import type { BusinessProfile } from "@/lib/proposal/types";

type Biz = BusinessProfile & { logoPath?: string | null };

export function CompanyEditor({ initial }: { initial: Biz }) {
  const [b, setB] = useState<Biz>(initial);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setStatus("saving");
    const t = setTimeout(async () => {
      const r = await fetch("/api/business", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ business: { ...b, logoUrl: null } }) }).catch(() => null);
      setStatus(r?.ok ? "saved" : "error");
    }, 800);
    return () => clearTimeout(t);
  }, [b]);
  return (
    <div>
      <p className="mx-auto mb-2 max-w-3xl text-right text-sm text-muted" role="status">{status === "saving" ? "Saving…" : status === "saved" ? "All changes saved" : status === "error" ? "Couldn't save. Check required fields and your connection." : ""}</p>
      <CompanyStep business={b} onChange={setB} signedIn />
    </div>
  );
}
