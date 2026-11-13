/**
 * Google Maps Places (New) address autocomplete, loaded lazily in the browser.
 * Needs NEXT_PUBLIC_GOOGLE_MAPS_API_KEY (a browser key restricted to our domains, with the
 * "Places API (New)" and "Maps JavaScript API" enabled). Without a key, or if Google fails to load,
 * address fields stay plain text inputs: autocomplete is a convenience, never a requirement.
 */

export interface AddressParts { city?: string; state?: string; zip?: string }
export interface AddressComponent { longText?: string | null; shortText?: string | null; types?: string[] }

export const mapsApiKey = () => process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
/** Comma-separated ISO region codes to limit suggestions to (default: United States). Empty = worldwide. */
export const mapsRegions = () => (process.env.NEXT_PUBLIC_GOOGLE_MAPS_REGIONS ?? "us").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

/** City, state and ZIP from a Places address, for the project location fields. */
export function parseAddressComponents(components: AddressComponent[] | null | undefined): AddressParts {
  const find = (...types: string[]) => (components ?? []).find((c) => types.some((t) => c.types?.includes(t)));
  const city = find("locality") ?? find("postal_town") ?? find("sublocality", "sublocality_level_1") ?? find("administrative_area_level_3");
  const state = find("administrative_area_level_1");
  const zip = find("postal_code");
  return {
    city: city?.longText ?? undefined,
    state: state?.shortText ?? state?.longText ?? undefined,
    zip: zip?.longText ?? undefined,
  };
}

/* Minimal shapes of the parts of the Places library we use (avoids a @types dependency). */
export interface PlacePrediction {
  text: { text: string };
  mainText?: { text: string } | null;
  secondaryText?: { text: string } | null;
  toPlace: () => { fetchFields: (o: { fields: string[] }) => Promise<unknown>; formattedAddress?: string | null; addressComponents?: AddressComponent[] | null };
}
export interface PlacesLibrary {
  AutocompleteSessionToken: new () => unknown;
  AutocompleteSuggestion: { fetchAutocompleteSuggestions: (req: Record<string, unknown>) => Promise<{ suggestions: { placePrediction: PlacePrediction | null }[] }> };
}

let loading: Promise<PlacesLibrary | null> | null = null;
let failed = false;

/** Loads the Maps JS API once per page. Resolves null (never throws) when unavailable. */
export function loadPlaces(): Promise<PlacesLibrary | null> {
  const key = mapsApiKey();
  if (!key || failed || typeof window === "undefined") return Promise.resolve(null);
  if (loading) return loading;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Google's globals
  const w = window as any;
  loading = new Promise<PlacesLibrary | null>((resolve) => {
    const done = () => w.google.maps.importLibrary("places").then((lib: PlacesLibrary) => resolve(lib), () => { failed = true; resolve(null); });
    // Google calls this when the key is invalid or not allowed on this domain.
    w.gm_authFailure = () => { failed = true; };
    if (w.google?.maps?.importLibrary) { done(); return; }
    w.__b2bMapsReady = done;
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&loading=async&v=weekly&callback=__b2bMapsReady`;
    s.async = true;
    s.onerror = () => { failed = true; resolve(null); };
    document.head.appendChild(s);
  });
  return loading;
}

export const placesUnavailable = () => failed;
