/**
 * Fictional identities for demo and practice data. Names are common first/last name pairs combined at
 * random, never a real person's record. Contact details are deliberately unusable:
 *   - email addresses use the reserved example domains (RFC 2606): example.com / .net / .org
 *   - phone numbers use 555-0100 to 555-0199, the range reserved for fiction in North America
 *   - towns and streets are invented, and no ZIP code is attached
 */
export const FIRST = [
  "Avery", "Jordan", "Morgan", "Riley", "Casey", "Taylor", "Jamie", "Quinn", "Reese", "Rowan", "Harper", "Emerson", "Logan", "Parker", "Sawyer",
  "Dana", "Elliot", "Frankie", "Gale", "Hayden", "Jesse", "Kendall", "Lane", "Marley", "Noel", "Oakley", "Peyton", "Remy", "Sage", "Tatum",
  "Blair", "Cameron", "Drew", "Ellis", "Finley", "Greer", "Hollis", "Indy", "Jules", "Kerry", "Lennon", "Micah", "Nico", "Oren", "Pat",
  "Robin", "Shay", "Toby", "Val", "Wren",
] as const;

export const LAST = [
  "Anderson", "Bergstrom", "Carlson", "Dahl", "Eriksen", "Fischer", "Gustafson", "Halvorsen", "Iverson", "Johansen", "Kowalski", "Lindqvist",
  "Moreno", "Nakamura", "Olsen", "Petersen", "Quist", "Ramirez", "Sorensen", "Thorne", "Underwood", "Vasquez", "Whitaker", "Xiong", "Yoder",
  "Zimmer", "Ahlgren", "Brennan", "Castillo", "Delgado", "Engstrom", "Foley", "Garrity", "Holm", "Ingram", "Jansen", "Kaur", "Lund", "Mattson",
  "Novak", "Okafor", "Pham", "Rasmussen", "Strand", "Tran", "Vang", "Wallin", "Yang", "Bauer", "Haugen",
] as const;

export const STREETS = [
  "Birchwood Ln", "Cedar Ridge Rd", "Juniper Ct", "Lakeview Dr", "Maple Hollow Way", "Northwind Ave", "Oak Bluff Trl", "Pine Meadow Dr",
  "Quarry Hill Rd", "Riverbend Pkwy", "Stonegate Cir", "Tamarack St", "Willow Creek Rd", "Aspen Grove Ln", "Fox Run Dr", "Heron Point Ct",
] as const;

/** Invented towns: none of these is meant to be a real place. */
export const TOWNS = ["Maple Hollow", "Riverbend", "North Lakes", "Pine Grove", "Elm Crossing", "Cedar Bluff"] as const;

export const EMAIL_DOMAINS = ["example.com", "example.net", "example.org"] as const;

export const BUSINESS_NAMES = ["Harbor Point Property Group", "Lakeside Rentals LLC", "Northgate Church", "Pine Grove HOA", "Elm Crossing Dental"] as const;

/** 555-01XX: reserved for fictional use, never assigned to a real line. */
export const fictionalPhone = (n: number) => `(651) 555-01${String(Math.abs(n) % 100).padStart(2, "0")}`;

export const STAFF = [
  { name: "Marcus Lindqvist", title: "Project manager", pay: "salary", rate: 42, trades: ["general-contracting", "kitchens", "bathrooms"] },
  { name: "Elena Moreno", title: "Lead carpenter", pay: "hourly", rate: 38, trades: ["decks", "general-contracting"] },
  { name: "Tyler Bergstrom", title: "Carpenter", pay: "hourly", rate: 31, trades: ["decks", "siding"] },
  { name: "Priya Nakamura", title: "Estimator", pay: "salary", rate: 36, trades: ["kitchens", "bathrooms", "painting"] },
  { name: "Dmitri Novak", title: "Concrete foreman", pay: "hourly", rate: 37, trades: ["concrete"] },
  { name: "Sam Okafor", title: "Painter", pay: "hourly", rate: 28, trades: ["painting", "drywall"] },
  { name: "Jess Halvorsen", title: "Exterior crew lead", pay: "hourly", rate: 34, trades: ["roofing", "siding", "pressure-washing", "soft-washing"] },
  { name: "Leo Vang", title: "Apprentice", pay: "hourly", rate: 22, trades: ["decks", "concrete", "drywall"] },
] as const;

export const SUBS = [
  { name: "Summit Roofing Partners", contact: "Avery Holm", trades: ["roofing"] },
  { name: "Bright Line Electric", contact: "Jordan Pham", trades: ["electrical"] },
  { name: "True Level Plumbing", contact: "Reese Iverson", trades: ["plumbing", "bathrooms", "kitchens"] },
  { name: "Granite & Quartz Works", contact: "Morgan Tran", trades: ["cabinets-countertops", "kitchens"] },
  { name: "Clear View Glass", contact: "Casey Dahl", trades: ["bathrooms"] },
  { name: "Northside Excavating", contact: "Riley Strand", trades: ["excavation", "concrete", "general-contracting"] },
  { name: "Precision Tile Co.", contact: "Quinn Ahlgren", trades: ["tile", "bathrooms", "kitchens"] },
  { name: "Overhead Door Pros", contact: "Taylor Lund", trades: ["general-contracting"] },
  { name: "Prairie Siding Supply & Install", contact: "Harper Wallin", trades: ["siding"] },
  { name: "Lakeshore Drywall", contact: "Rowan Mattson", trades: ["drywall"] },
  { name: "Evergreen Gutters", contact: "Sawyer Foley", trades: ["gutters", "roofing"] },
  { name: "Ironclad Permits & Inspections", contact: "Parker Jansen", trades: ["general-contracting", "electrical"] },
] as const;
