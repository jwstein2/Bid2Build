/**
 * Event-based geofencing on the employee's device (pure logic, no I/O). Used by the browser clock screen while it
 * is open, and documents the contract a native app follows (it sends the same four events to the same endpoint).
 *
 * Only these events leave the device: enter, dwell (still inside after the company's dwell time), exit (first
 * confident reading outside) and exit_confirmed (still outside after the grace period). Each carries the distance
 * from the site centre and the GPS accuracy, never coordinates. Readings that aren't clearly inside or clearly
 * outside change nothing, so a weak signal never clocks anyone in or out.
 */

export interface Reading { lat: number; lng: number; accuracyM: number; at: number }
export interface Site { id: string; name: string; lat: number; lng: number; radiusM: number }
export type GeoEventKind = "enter" | "dwell" | "exit" | "exit_confirmed";
export interface GeoEvent { kind: GeoEventKind; locationId: string; occurredAt: string; accuracyM: number; distanceM: number }
export interface GeofenceOptions { dwellMin: number; graceMin: number; maxAccuracyM: number }

const R = 6_371_008.8; // mean Earth radius, metres
const rad = (d: number) => (d * Math.PI) / 180;
/** Great-circle distance in metres. */
export function distanceM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = rad(bLat - aLat), dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type Placement = "inside" | "outside" | "uncertain";
/**
 * inside    : centre of the reading within the radius, with usable accuracy
 * outside   : even the nearest edge of the accuracy circle is beyond the radius (and accuracy isn't terrible)
 * uncertain : anything else (no change)
 * The server applies the same rule to what it receives.
 */
export function place(r: Reading, s: Site, maxAccuracyM: number): { placement: Placement; distanceM: number } {
  const d = distanceM(r.lat, r.lng, s.lat, s.lng);
  if (r.accuracyM <= maxAccuracyM && d <= s.radiusM) return { placement: "inside", distanceM: d };
  if (r.accuracyM <= maxAccuracyM * 2 && d - r.accuracyM > s.radiusM) return { placement: "outside", distanceM: d };
  return { placement: "uncertain", distanceM: d };
}

type SiteState = { state: "unknown" } | { state: "out" } | { state: "in"; since: number; dwellSent: boolean } | { state: "left"; since: number; confirmSent: boolean };

export class GeofenceTracker {
  private sites = new Map<string, Site>();
  private states = new Map<string, SiteState>();
  constructor(private opts: GeofenceOptions) {}

  setSites(sites: Site[]) {
    this.sites = new Map(sites.map((s) => [s.id, s]));
    for (const id of [...this.states.keys()]) if (!this.sites.has(id)) this.states.delete(id);
  }
  setOptions(o: GeofenceOptions) { this.opts = o; }
  /** Current state per site (for the status line on the clock screen). */
  snapshot(): Record<string, SiteState["state"]> { return Object.fromEntries([...this.sites.keys()].map((id) => [id, this.states.get(id)?.state ?? "unknown"])); }
  /** Forget a site's state (e.g. after the employee answered a prompt) so the next readings start fresh. */
  reset(id?: string) { if (id) this.states.delete(id); else this.states.clear(); }

  /** Feed one location reading; returns the events to send, oldest first. */
  feed(r: Reading): GeoEvent[] {
    const out: GeoEvent[] = [];
    const dwellMs = this.opts.dwellMin * 60_000, graceMs = this.opts.graceMin * 60_000;
    for (const s of this.sites.values()) {
      const { placement, distanceM: d } = place(r, s, this.opts.maxAccuracyM);
      const st = this.states.get(s.id) ?? { state: "unknown" };
      const ev = (kind: GeoEventKind): GeoEvent => ({ kind, locationId: s.id, occurredAt: new Date(r.at).toISOString(), accuracyM: Math.round(r.accuracyM), distanceM: Math.round(d) });
      if (placement === "inside") {
        if (st.state === "in") {
          if (!st.dwellSent && r.at - st.since >= dwellMs) { out.push(ev("dwell")); this.states.set(s.id, { ...st, dwellSent: true }); }
        } else {
          out.push(ev("enter"));
          this.states.set(s.id, { state: "in", since: r.at, dwellSent: false });
          if (dwellMs <= 0) { out.push(ev("dwell")); this.states.set(s.id, { state: "in", since: r.at, dwellSent: true }); }
        }
      } else if (placement === "outside") {
        if (st.state === "in") {
          out.push(ev("exit"));
          this.states.set(s.id, { state: "left", since: r.at, confirmSent: false });
        } else if (st.state === "left") {
          if (!st.confirmSent && r.at - st.since >= graceMs) { out.push(ev("exit_confirmed")); this.states.set(s.id, { ...st, confirmSent: true }); }
        } else if (st.state === "unknown") {
          this.states.set(s.id, { state: "out" });
        }
      }
    }
    return out;
  }
}

/** Idempotency key for one event (unique per employee on the server; at most 80 characters, so a retried send never doubles). */
export function clientEventId(e: Pick<GeoEvent, "locationId" | "kind" | "occurredAt">): string {
  return `${e.locationId}:${e.kind}:${Date.parse(e.occurredAt).toString(36)}`;
}

/** Plain-language reliability for a geofence radius (shown when the admin picks one). */
export function radiusGuidance(radiusM: number): { tone: "ok" | "warn" | "danger"; text: string } {
  if (radiusM > 322) return { tone: "danger", text: "The maximum is 0.2 miles (322 m)." };
  if (radiusM >= 150) return { tone: "ok", text: "Reliable on phones, including a future native app running in the background." };
  if (radiusM >= 100) return { tone: "ok", text: "Reliable outdoors. Native background geofencing (iPhone and Android) works best at 100 m or more." };
  if (radiusM >= 50) return { tone: "warn", text: "Works with good GPS outdoors while the app is open. Phone GPS is often 20-65 m off near buildings or indoors, so some arrivals may be missed. Native background geofencing isn't dependable this small." };
  return { tone: "danger", text: "Too small to rely on: everyday phone GPS error is about this size. Expect missed or late clock-ins; employees can always clock in by hand." };
}

export const MILE_M = 1609.344;
export const RADIUS_PRESETS = [
  { label: "0.2 mi (322 m)", m: 322 },
  { label: "0.1 mi (161 m)", m: 161 },
  { label: "0.05 mi (80 m)", m: 80 },
] as const;
export const fmtRadius = (m: number) => `${(m / MILE_M).toFixed(m < 100 ? 3 : 2).replace(/0+$/, "").replace(/\.$/, "")} mi (${Math.round(m)} m)`;
