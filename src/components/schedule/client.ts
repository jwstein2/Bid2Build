"use client";
import type { TaskStatus } from "@/lib/schedule/types";

export async function api<T>(url: string, init: RequestInit & { body?: string } = {}): Promise<{ ok: true; data: T } | { ok: false; status: number; code: string; message: string; extra: Record<string, unknown> }> {
  try {
    const res = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) } });
    const body = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, data: body as T };
    const e = (body as { error?: { code?: string; message?: string } }).error ?? {};
    return { ok: false, status: res.status, code: e.code ?? "error", message: e.message ?? "Something went wrong. Please try again.", extra: e as Record<string, unknown> };
  } catch {
    return { ok: false, status: 0, code: "network", message: "You appear to be offline. Nothing was saved.", extra: {} };
  }
}

/** Status colors: fill for the planned bar, plus a text label (never color alone). */
export const STATUS_STYLE: Record<TaskStatus, { bar: string; fill: string; chip: string }> = {
  not_started: { bar: "bg-[#E6ECF2] border-[#9FB0C1]", fill: "bg-[#6B7A89]", chip: "bg-black/5 text-ink-soft" },
  in_progress: { bar: "bg-accent-tint border-accent-ink/60", fill: "bg-accent-ink", chip: "bg-accent-tint text-accent-dark" },
  complete: { bar: "bg-ok-tint border-ok/60", fill: "bg-ok", chip: "bg-ok-tint text-ok" },
  delayed: { bar: "bg-warn-tint border-warn/70", fill: "bg-warn", chip: "bg-warn-tint text-warn" },
  on_hold: { bar: "bg-[#EFE9F8] border-[#7C5CB8]/60", fill: "bg-[#6A4BA8]", chip: "bg-[#EFE9F8] text-[#5B3E99]" },
};

export const COMMON_TIMEZONES = [
  "America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu",
];

let seq = 0;
export const newId = () => `new-${Date.now().toString(36)}-${(++seq).toString(36)}`;
