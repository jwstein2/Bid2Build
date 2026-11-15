import { cleanZip, normalizeState, zip3State } from "@/lib/market/geo";

export interface ParsedAddress { zip: string | null; state: string | null; city: string | null }

const COUNTRY = /[,\s]+(?:usa|u\.s\.a\.|us|united states(?: of america)?)\.?\s*$/i;

/**
 * Pull city, state and ZIP out of a typed US address such as "123 Main St, Austin, TX 78701".
 *
 * Conservative on purpose: it only reads the END of the address, where US addresses put
 * "City, ST 12345". When something is ambiguous it returns null for that part instead of guessing:
 *  - a two-letter state without a comma before it must be upper case ("... Austin TX"),
 *  - a state that disagrees with the ZIP's prefix is dropped (the ZIP wins, it is more specific).
 */
export function parseUsAddress(raw: string | null | undefined): ParsedAddress {
  const none = { zip: null, state: null, city: null };
  let s = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!s) return none;
  s = s.replace(COUNTRY, "").trim();

  let zip: string | null = null;
  const zm = /(?:^|[\s,])(\d{5})(?:-\d{4})?$/.exec(s);
  if (zm) {
    zip = cleanZip(zm[1]);
    s = s.slice(0, zm.index).replace(/[\s,]+$/, "");
  }

  let state: string | null = null;
  let rest = s;
  // "..., Austin, TX" / "..., Austin, Texas": last comma segment, or its last word(s).
  const lastComma = s.lastIndexOf(",");
  const tail = lastComma >= 0 ? s.slice(lastComma + 1).trim() : "";
  // A two-letter tail must be upper case ("..., TX"), so words like "in" or "or" never read as states.
  const tailOk = tail && normalizeState(tail) && (tail.replace(/\./g, "").length > 2 || tail === tail.toUpperCase());
  if (tailOk) {
    state = normalizeState(tail);
    rest = s.slice(0, lastComma).trim();
  } else {
    // "Austin TX" at the end of a segment: only an exact upper-case code counts.
    const cm = /(?:^|[\s,])([A-Z]{2})$/.exec(s);
    if (cm && normalizeState(cm[1])) {
      state = normalizeState(cm[1]);
      rest = s.slice(0, cm.index).replace(/[\s,]+$/, "");
    } else if (tail) {
      // Full state name as the last words of the last segment ("..., Austin Texas").
      const words = tail.split(" ");
      for (let n = Math.min(3, words.length - 1); n >= 1; n--) {
        const cand = normalizeState(words.slice(-n).join(" "));
        if (cand && cand.length === 2 && words.slice(-n).join(" ").length > 2) {
          state = cand;
          rest = s.slice(0, s.length - words.slice(-n).join(" ").length).replace(/[\s,]+$/, "");
          break;
        }
      }
    }
  }

  if (zip && state) {
    const fromZip = zip3State(zip.slice(0, 3));
    if (fromZip && fromZip !== state) state = null;
  }

  let city: string | null = null;
  if (state || zip) {
    const segs = rest.split(",").map((x) => x.trim()).filter(Boolean);
    const c = segs.length >= 2 ? segs[segs.length - 1] : null;
    if (c && !/\d/.test(c) && c.length <= 60) city = c;
  }
  return { zip, state, city };
}

/**
 * Fill EMPTY structured location fields from the typed project address. Never overwrites anything
 * the contractor typed or picked. Returns the same object when nothing changes.
 */
export function fillLocationFromAddress<T extends { zip?: string; city?: string; state?: string }>(location: T, address: string | null | undefined): T {
  const has = (v?: string) => Boolean(v && v.trim());
  if (has(location.zip) && has(location.state)) return location;
  const p = parseUsAddress(address);
  const patch: Partial<T> = {};
  if (!has(location.zip) && p.zip) patch.zip = p.zip as T["zip"];
  if (!has(location.state) && p.state) {
    // Don't add a state that contradicts a ZIP the contractor already entered.
    const enteredZip = cleanZip(location.zip);
    const zipState = enteredZip ? zip3State(enteredZip.slice(0, 3)) : null;
    if (!zipState || zipState === p.state) patch.state = p.state as T["state"];
  }
  if (!has(location.city) && p.city && (patch.state || patch.zip)) patch.city = p.city as T["city"];
  return Object.keys(patch).length ? { ...location, ...patch } : location;
}

/** Where a bid's state came from, for data-quality reporting. */
export type StateSource = "state_field" | "zip" | "address" | null;

/** Best available state for reporting: entered ZIP (authoritative), entered state, then the typed address. */
export function bidState(row: { location_state?: string | null; location_zip?: string | null; project_address?: string | null }): { state: string | null; zip: string | null; source: StateSource } {
  const zip = cleanZip(row.location_zip);
  const fromZip = zip ? zip3State(zip.slice(0, 3)) : null;
  if (fromZip) return { state: fromZip, zip, source: "zip" };
  const entered = normalizeState(row.location_state);
  if (entered) return { state: entered, zip, source: "state_field" };
  const p = parseUsAddress(row.project_address);
  const fromAddr = p.zip ? zip3State(p.zip.slice(0, 3)) : null;
  const st = fromAddr ?? p.state;
  return st ? { state: st, zip: zip ?? p.zip, source: "address" } : { state: null, zip: zip ?? p.zip, source: null };
}
