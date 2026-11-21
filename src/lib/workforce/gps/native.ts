/**
 * Bridge to the Built2Bid Android app (android/). Inside the app, the page gets `window.Built2BidNative` (only on
 * the Built2Bid origin). The app then watches today's assigned sites with Android geofencing, which keeps working
 * when the app is closed, and sends the same enter / dwell / exit / exit_confirmed events to /api/workforce/gps/me
 * with source "native_android". In a normal browser none of this exists and the on-screen tracker is used.
 */

export interface NativeState {
  app: "android";
  version: string;
  /** Location permission for the app ("granted" = at least while using the app). */
  location: "granted" | "prompt" | "denied";
  /** "Allow all the time": needed for clock-in while the app is closed. */
  background: boolean;
  notifications: boolean;
  batteryUnrestricted: boolean;
  /** Geofences for the synced sites are registered right now. */
  tracking: boolean;
  sites: number;
  error: string | null;
}

export interface NativeSite { id: string; name: string; lat: number; lng: number; radiusM: number }
export interface NativeSync { resourceId: string; sites: NativeSite[]; dwellMin: number; graceMin: number; maxAccuracyM: number }

interface Port { postMessage(data: string): void; onmessage: ((e: { data: string }) => void) | null; addEventListener?: (t: "message", fn: (e: { data: string }) => void) => void }

function port(): Port | null {
  if (typeof window === "undefined") return null;
  const p = (window as unknown as { Built2BidNative?: Port }).Built2BidNative;
  return p && typeof p.postMessage === "function" ? p : null;
}

/** True inside the Built2Bid Android app. */
export function inAndroidApp(): boolean {
  return port() !== null;
}

/** Parses a state message from the app; anything unexpected is ignored. */
export function parseNativeState(raw: unknown): NativeState | null {
  let o: unknown = raw;
  if (typeof raw === "string") { try { o = JSON.parse(raw); } catch { return null; } }
  if (!o || typeof o !== "object") return null;
  const r = o as Record<string, unknown>;
  if (r.type !== "state" || r.app !== "android") return null;
  const location = r.location === "granted" || r.location === "denied" ? r.location : "prompt";
  return {
    app: "android", version: String(r.version ?? ""), location, background: r.background === true, notifications: r.notifications === true,
    batteryUnrestricted: r.batteryUnrestricted === true, tracking: r.tracking === true, sites: Number(r.sites) || 0,
    error: typeof r.error === "string" ? r.error : null,
  };
}

const listeners = new Set<(s: NativeState) => void>();
let wired = false;
function wire(p: Port) {
  if (wired) return;
  wired = true;
  const handler = (e: { data: string }) => { const s = parseNativeState(e.data); if (s) listeners.forEach((fn) => fn(s)); };
  if (p.addEventListener) p.addEventListener("message", handler); else p.onmessage = handler;
}

/** Subscribe to app state; asks for it right away. Returns an unsubscribe function. */
export function onNativeState(fn: (s: NativeState) => void): () => void {
  const p = port();
  if (!p) return () => {};
  wire(p);
  listeners.add(fn);
  p.postMessage(JSON.stringify({ type: "hello" }));
  return () => { listeners.delete(fn); };
}

function send(msg: Record<string, unknown>) { port()?.postMessage(JSON.stringify(msg)); }

/** Hand today's sites to the app (it re-registers only when something changed). */
export function nativeSync(s: NativeSync) { send({ type: "sync", ...s }); }
/** Remove all geofences (employee turned automatic clock-in off, or the company did). */
export function nativeStop() { send({ type: "stop" }); }
/** In-app disclosure, then location "Allow all the time", then notifications. */
export function nativeRequestPermission() { send({ type: "permission" }); }
/** Opens Android's battery optimization list so the phone doesn't stop Built2Bid. */
export function nativeBatterySettings() { send({ type: "battery" }); }
