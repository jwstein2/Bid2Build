"use client";
import { MapPin } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { loadPlaces, mapsApiKey, mapsRegions, parseAddressComponents, placesUnavailable, type AddressParts, type PlacePrediction, type PlacesLibrary } from "@/lib/maps/places";

interface Props {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** Called after a suggestion is chosen, with the parsed city/state/ZIP. */
  onPick?: (parts: AddressParts) => void;
  multiline?: boolean;
  className?: string;
  autoComplete?: string;
  placeholder?: string;
}

/**
 * Address field with Google Places suggestions as you type. Typing freely always works; picking a
 * suggestion fills the full formatted address. Without a Maps key it is a plain input.
 */
export function AddressInput({ id, value, onChange, onPick, multiline, className, autoComplete = "street-address", placeholder }: Props) {
  const enabled = Boolean(mapsApiKey());
  const listId = useId();
  const [lib, setLib] = useState<PlacesLibrary | null>(null);
  const [items, setItems] = useState<PlacePrediction[]>([]);
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const token = useRef<unknown>(null);
  const typed = useRef(false);
  const seq = useRef(0);

  // Fetch suggestions for what the user typed (debounced). Never for programmatic value changes.
  useEffect(() => {
    if (!lib || !typed.current) return;
    const q = value.trim();
    if (q.length < 3) return; // short input: the list is hidden at render time
    const n = ++seq.current;
    const t = setTimeout(async () => {
      try {
        token.current ??= new lib.AutocompleteSessionToken();
        const regions = mapsRegions();
        const { suggestions } = await lib.AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: q, sessionToken: token.current, ...(regions.length ? { includedRegionCodes: regions } : {}),
        });
        if (n !== seq.current) return;
        setItems(suggestions.map((s) => s.placePrediction).filter((p): p is PlacePrediction => Boolean(p)).slice(0, 5));
        setActive(-1);
        setOpen(true);
      } catch { if (n === seq.current) setItems([]); }
    }, 250);
    return () => clearTimeout(t);
  }, [value, lib]);

  const ensureLib = () => { if (enabled && !lib && !placesUnavailable()) void loadPlaces().then(setLib); };

  const pick = async (p: PlacePrediction) => {
    setOpen(false); setItems([]); typed.current = false;
    onChange(p.text.text);
    try {
      const place = p.toPlace();
      await place.fetchFields({ fields: ["formattedAddress", "addressComponents"] });
      if (place.formattedAddress) onChange(place.formattedAddress);
      onPick?.(parseAddressComponents(place.addressComponents));
    } catch { /* keep the suggestion text */ }
    token.current = null; // a pick ends the billing session
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open || !items.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % items.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a <= 0 ? items.length - 1 : a - 1)); }
    else if (e.key === "Enter" && active >= 0) { e.preventDefault(); void pick(items[active]); }
    else if (e.key === "Escape") { setOpen(false); }
  };

  const showList = open && items.length > 0 && value.trim().length >= 3;
  const common = {
    id, value, autoComplete: lib ? "off" : autoComplete, placeholder,
    className: cn("field", className),
    onFocus: ensureLib,
    onBlur: () => setTimeout(() => setOpen(false), 150),
    onKeyDown,
    ...(enabled ? { role: "combobox", "aria-autocomplete": "list" as const, "aria-expanded": showList, "aria-controls": listId, "aria-activedescendant": active >= 0 ? `${listId}-${active}` : undefined } : {}),
  };
  const change = (v: string) => { typed.current = true; onChange(v); };

  return (
    <div className="relative">
      {multiline
        ? <textarea rows={2} {...common} onChange={(e) => change(e.target.value)} />
        : <input {...common} onChange={(e) => change(e.target.value)} />}
      {showList && (
        <ul id={listId} role="listbox" className="absolute inset-x-0 z-40 mt-1 max-h-72 overflow-y-auto rounded-lg border border-line bg-surface py-1 text-sm shadow-xl">
          {items.map((p, i) => (
            <li
              key={`${p.text.text}-${i}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); void pick(p); }}
              onMouseEnter={() => setActive(i)}
              className={cn("flex min-h-11 cursor-pointer items-start gap-2 px-3 py-2", i === active && "bg-brand-tint")}
            >
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />
              <span className="min-w-0">
                <span className="block font-medium text-ink">{p.mainText?.text ?? p.text.text}</span>
                {p.secondaryText?.text && <span className="block text-xs text-muted">{p.secondaryText.text}</span>}
              </span>
            </li>
          ))}
          <li role="presentation" className="px-3 pb-1 pt-1.5 text-right text-[11px] text-muted">powered by Google</li>
        </ul>
      )}
    </div>
  );
}
