/**
 * Bus operators.
 *
 * SafiriConnect is modelled as a booking platform rather than a single fleet —
 * which is how ticketing actually works in Kenya, where a passenger compares
 * several companies on the same corridor and picks on price, comfort and
 * reputation. The seeded companies are real long-distance operators; the fleet
 * sizes and ratings attached to them are illustrative.
 */

export type SeedOperator = {
  name: string;
  /** Short code shown on manifests and vehicle liveries. */
  code: string;
  /** Brand colour, used for the chip in search results. */
  colour: string;
  /** Out of 5, one decimal place. */
  rating: number;
  /** Corridors this company is known for, used to keep assignment plausible. */
  strongholds: string[];
  tagline: string;
};

export const OPERATORS: SeedOperator[] = [
  {
    name: "Tahmeed Coach",
    code: "TAH",
    colour: "#1f7a4d",
    rating: 4.1,
    strongholds: ["Mombasa", "Malindi", "Nairobi", "Garissa", "Dar es Salaam"],
    tagline: "Coast and cross-border services",
  },
  {
    name: "Easy Coach",
    code: "EZC",
    colour: "#0b6ea8",
    rating: 4.4,
    strongholds: ["Kisumu", "Kakamega", "Bungoma", "Busia", "Kisii", "Eldoret", "Nairobi"],
    tagline: "Western Kenya specialists",
  },
  {
    name: "Modern Coast",
    code: "MCO",
    colour: "#c2410c",
    rating: 4.3,
    strongholds: ["Mombasa", "Nairobi", "Kisumu", "Kampala", "Dar es Salaam", "Malindi"],
    tagline: "Oxygen and Executive class",
  },
  {
    name: "Mash Poa",
    code: "MSH",
    colour: "#7c3aed",
    rating: 4.2,
    strongholds: ["Mombasa", "Nairobi", "Malindi", "Kampala", "Kisumu"],
    tagline: "Overnight coast express",
  },
  {
    name: "Coast Bus",
    code: "CST",
    colour: "#0891b2",
    rating: 3.9,
    strongholds: ["Mombasa", "Nairobi", "Voi", "Malindi"],
    tagline: "The original coast service",
  },
  {
    name: "Guardian Angel",
    code: "GRD",
    colour: "#b91c1c",
    rating: 3.8,
    strongholds: ["Nairobi", "Kisii", "Migori", "Homa Bay", "Kisumu", "Narok"],
    tagline: "South Nyanza network",
  },
  {
    name: "Dreamline Express",
    code: "DRM",
    colour: "#4338ca",
    rating: 4.0,
    strongholds: ["Nairobi", "Mombasa", "Kisumu", "Kakamega"],
    tagline: "Business class coaches",
  },
  {
    name: "Chania Genesis",
    code: "CHA",
    colour: "#15803d",
    rating: 3.9,
    strongholds: ["Nairobi", "Thika", "Nyeri", "Nanyuki", "Meru", "Embu"],
    tagline: "Mount Kenya region",
  },
  {
    name: "2NK Sacco",
    code: "2NK",
    colour: "#a16207",
    rating: 3.7,
    strongholds: ["Nairobi", "Nyeri", "Nanyuki", "Nyahururu", "Karatina"],
    tagline: "Central highlands shuttles",
  },
  {
    name: "North Rift Shuttle",
    code: "NRS",
    colour: "#0f766e",
    rating: 4.0,
    strongholds: ["Eldoret", "Kitale", "Nakuru", "Nairobi", "Lodwar", "Kapenguria"],
    tagline: "Rift Valley and the north",
  },
  {
    name: "Transline Classic",
    code: "TRL",
    colour: "#be185d",
    rating: 4.1,
    strongholds: ["Nairobi", "Kisii", "Kisumu", "Migori", "Nyamira"],
    tagline: "Nyanza classic service",
  },
  {
    name: "Simba Coach",
    code: "SMB",
    colour: "#ca8a04",
    rating: 3.8,
    strongholds: ["Nairobi", "Kampala", "Kigali", "Bujumbura", "Juba"],
    tagline: "East African cross-border",
  },
  {
    name: "Crown Bus",
    code: "CRW",
    colour: "#1d4ed8",
    rating: 3.9,
    strongholds: ["Nairobi", "Kisumu", "Kakamega", "Eldoret", "Bungoma"],
    tagline: "Western express",
  },
  {
    name: "Greenline Safaris",
    code: "GRN",
    colour: "#059669",
    rating: 4.2,
    strongholds: ["Nairobi", "Arusha", "Moshi", "Namanga Border"],
    tagline: "Northern Tanzania routes",
  },
  {
    name: "Mombasa Raha",
    code: "MRH",
    colour: "#9333ea",
    rating: 3.6,
    strongholds: ["Mombasa", "Nairobi", "Voi", "Mariakani"],
    tagline: "Budget coast travel",
  },
];

/**
 * Which operators plausibly serve a corridor.
 *
 * Matching on *either* endpoint does not work, because almost every company
 * lists Nairobi — so a one-ended test put all fifteen operators on
 * Nairobi–Mombasa, including western-Kenya and Mount Kenya specialists that
 * have never run the coast road.
 *
 * Preferring companies strong at *both* ends discriminates properly: it leaves
 * the coast operators on the coast route and the Nyanza operators on Nyanza
 * routes. The looser tests below are fallbacks so that an obscure corridor
 * still has a carrier rather than being unbookable.
 */
export function operatorsFor(origin: string, destination: string): SeedOperator[] {
  const bothEnds = OPERATORS.filter(
    (o) => o.strongholds.includes(origin) && o.strongholds.includes(destination),
  );
  if (bothEnds.length >= 2) return bothEnds;

  const eitherEnd = OPERATORS.filter(
    (o) => o.strongholds.includes(origin) || o.strongholds.includes(destination),
  );
  if (eitherEnd.length >= 2) return eitherEnd;

  return OPERATORS;
}
