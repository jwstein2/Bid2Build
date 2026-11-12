/**
 * Geographic generalization. Observations store the 3-digit ZIP prefix, state, and metro market.
 * Five-digit ZIPs are kept only in the restricted analytics table and are reported solely when a
 * ZIP segment clears the contributor threshold.
 */

// [first zip3, last zip3, state] — USPS prefix ranges.
const RANGES: [number, number, string][] = [
  [5, 5, "NY"], [6, 7, "PR"], [8, 8, "VI"], [9, 9, "PR"],
  [10, 27, "MA"], [28, 29, "RI"], [30, 38, "NH"], [39, 49, "ME"], [50, 54, "VT"], [55, 55, "MA"], [56, 59, "VT"],
  [60, 69, "CT"], [70, 89, "NJ"], [100, 149, "NY"], [150, 196, "PA"], [197, 199, "DE"], [200, 200, "DC"],
  [201, 201, "VA"], [202, 205, "DC"], [206, 219, "MD"], [220, 246, "VA"], [247, 268, "WV"], [270, 289, "NC"],
  [290, 299, "SC"], [300, 319, "GA"], [320, 339, "FL"], [341, 342, "FL"], [344, 344, "FL"], [346, 347, "FL"], [349, 349, "FL"],
  [350, 369, "AL"], [370, 385, "TN"], [386, 397, "MS"], [398, 399, "GA"], [400, 427, "KY"], [430, 459, "OH"],
  [460, 479, "IN"], [480, 499, "MI"], [500, 528, "IA"], [530, 549, "WI"], [550, 567, "MN"], [569, 569, "DC"],
  [570, 577, "SD"], [580, 588, "ND"], [590, 599, "MT"], [600, 629, "IL"], [630, 658, "MO"], [660, 679, "KS"],
  [680, 693, "NE"], [700, 714, "LA"], [716, 729, "AR"], [730, 749, "OK"], [750, 799, "TX"], [800, 816, "CO"],
  [820, 831, "WY"], [832, 838, "ID"], [840, 847, "UT"], [850, 865, "AZ"], [870, 884, "NM"], [885, 885, "TX"],
  [889, 898, "NV"], [900, 961, "CA"], [967, 968, "HI"], [969, 969, "GU"], [970, 979, "OR"], [980, 994, "WA"], [995, 999, "AK"],
];

export const US_STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", PR: "Puerto Rico",
  VI: "U.S. Virgin Islands", GU: "Guam",
};
const NAME_TO_CODE = new Map(Object.entries(US_STATES).map(([c, n]) => [n.toLowerCase(), c]));

/**
 * Starter metro mapping by ZIP prefix (core prefixes of the largest US metros). Unmapped prefixes
 * report as "Rest of <state>". Replace with a full HUD/USPS ZIP-to-CBSA crosswalk before relying on
 * metro-level reports for anything beyond internal monitoring.
 */
const METROS: Record<string, string[]> = {
  "New York, NY": ["100", "101", "102", "103", "104", "110", "111", "112", "113", "114", "116", "070", "071", "072", "073", "074", "075", "076", "105", "106", "107", "108"],
  "Los Angeles, CA": ["900", "901", "902", "903", "904", "905", "906", "907", "908", "910", "911", "912", "913", "914", "915", "916", "917", "918", "926", "927", "928"],
  "Chicago, IL": ["600", "601", "602", "603", "604", "605", "606", "607", "608"],
  "Dallas-Fort Worth, TX": ["750", "751", "752", "753", "760", "761", "762"],
  "Houston, TX": ["770", "772", "773", "774", "775"],
  "Washington, DC": ["200", "202", "203", "204", "205", "207", "208", "209", "220", "221", "222", "223"],
  "Philadelphia, PA": ["189", "190", "191", "193", "194", "080", "081"],
  "Miami, FL": ["330", "331", "332", "333", "334"],
  "Atlanta, GA": ["300", "301", "302", "303", "305", "306"],
  "Boston, MA": ["017", "018", "019", "020", "021", "022", "023", "024"],
  "Phoenix, AZ": ["850", "852", "853"],
  "San Francisco Bay Area, CA": ["940", "941", "943", "944", "945", "946", "947", "948", "949", "950", "951"],
  "Riverside-San Bernardino, CA": ["922", "923", "924", "925"],
  "Detroit, MI": ["480", "481", "482", "483"],
  "Seattle, WA": ["980", "981", "982", "983", "984"],
  "Minneapolis-St. Paul, MN": ["550", "551", "553", "554", "555"],
  "San Diego, CA": ["919", "920", "921"],
  "Tampa, FL": ["335", "336", "337", "346"],
  "Denver, CO": ["800", "801", "802", "803", "804"],
  "St. Louis, MO": ["620", "630", "631", "633"],
  "Baltimore, MD": ["210", "211", "212", "214"],
  "Orlando, FL": ["327", "328", "347"],
  "Charlotte, NC": ["280", "281", "282", "297"],
  "San Antonio, TX": ["780", "781", "782"],
  "Portland, OR": ["970", "971", "972", "986"],
  "Sacramento, CA": ["956", "957", "958"],
  "Pittsburgh, PA": ["150", "151", "152", "153", "156"],
  "Austin, TX": ["786", "787"],
  "Las Vegas, NV": ["889", "890", "891"],
  "Cincinnati, OH": ["410", "450", "451", "452"],
  "Kansas City, MO-KS": ["640", "641", "660", "661", "662"],
  "Columbus, OH": ["430", "431", "432"],
  "Indianapolis, IN": ["460", "461", "462"],
  "Cleveland, OH": ["440", "441", "442"],
  "Nashville, TN": ["370", "371", "372"],
  "Raleigh-Durham, NC": ["275", "276", "277"],
  "Salt Lake City, UT": ["840", "841"],
  "Milwaukee, WI": ["530", "531", "532"],
  "Jacksonville, FL": ["320", "322"],
  "Oklahoma City, OK": ["730", "731"],
  "Louisville, KY": ["400", "401", "402"],
  "Memphis, TN": ["380", "381"],
  "Richmond, VA": ["230", "231", "232"],
  "New Orleans, LA": ["700", "701"],
  "Albuquerque, NM": ["870", "871"],
  "Tucson, AZ": ["856", "857"],
};
const ZIP3_METRO = new Map<string, string>();
for (const [metro, prefixes] of Object.entries(METROS)) for (const p of prefixes) if (!ZIP3_METRO.has(p)) ZIP3_METRO.set(p, metro);

export function cleanZip(zip: string | null | undefined): string | null {
  const m = /^\s*(\d{5})(?:-\d{4})?\s*$/.exec(zip ?? "");
  return m ? m[1] : null;
}

export function zip3State(zip3: string): string | null {
  const n = Number(zip3);
  if (!/^\d{3}$/.test(zip3)) return null;
  for (const [a, b, s] of RANGES) if (n >= a && n <= b) return s;
  return null;
}

export function normalizeState(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const up = s.toUpperCase().replace(/\./g, "");
  if (US_STATES[up]) return up;
  return NAME_TO_CODE.get(s.toLowerCase()) ?? null;
}

export interface Geo {
  zip5: string | null;
  zip3: string | null;
  state: string | null;
  metro: string | null;
  /** True when the entered state disagrees with the ZIP prefix (kept, but flagged for data quality). */
  stateConflict: boolean;
}

/** ZIP is authoritative for state when both are present; the entered state fills gaps. */
export function resolveGeo(location: { zip?: string; state?: string }): Geo {
  const zip5 = cleanZip(location.zip);
  const zip3 = zip5 ? zip5.slice(0, 3) : null;
  const fromZip = zip3 ? zip3State(zip3) : null;
  const entered = normalizeState(location.state);
  const state = fromZip ?? entered;
  const metro = zip3 ? (ZIP3_METRO.get(zip3) ?? (state ? `Rest of ${state}` : null)) : null;
  return { zip5, zip3, state, metro, stateConflict: Boolean(fromZip && entered && fromZip !== entered) };
}
