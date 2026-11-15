"use client";
import { useSyncExternalStore } from "react";
import { signedWhen } from "@/lib/esign/status";

const subscribe = () => () => {};

/** "Today at 2:14 PM" in the viewer's own time zone (the server renders a UTC fallback). */
export function LocalTime({ iso, relative = true }: { iso: string; relative?: boolean }) {
  const local = useSyncExternalStore(subscribe, () => true, () => false);
  const d = new Date(iso);
  const text = local
    ? relative ? signedWhen(iso) : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
  return <time dateTime={iso} title={d.toISOString()}>{text}</time>;
}
