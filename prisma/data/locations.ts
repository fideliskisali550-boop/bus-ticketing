/**
 * The place catalogue: Kenya's 47 counties with their principal towns, the bus
 * terminals long-distance services actually depart from, the border posts, and
 * the East African cities Kenyan operators serve.
 *
 * Coordinates are approximate town centres, carried so the data is ready for
 * map rendering and distance estimation later.
 */

export type SeedLocation = {
  name: string;
  type: "COUNTY" | "CITY" | "TOWN" | "TERMINAL" | "BORDER" | "AIRPORT";
  county?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  aliases?: string[];
};

/** All 47 counties, with the county headquarters town and its coordinates. */
export const COUNTIES: {
  county: string;
  capital: string;
  lat: number;
  lng: number;
  towns: string[];
}[] = [
  { county: "Mombasa", capital: "Mombasa", lat: -4.0435, lng: 39.6682, towns: ["Likoni", "Nyali", "Changamwe"] },
  { county: "Kwale", capital: "Kwale", lat: -4.1737, lng: 39.4521, towns: ["Ukunda", "Diani", "Msambweni", "Lunga Lunga"] },
  { county: "Kilifi", capital: "Kilifi", lat: -3.6305, lng: 39.8499, towns: ["Malindi", "Watamu", "Mariakani", "Mtwapa"] },
  { county: "Tana River", capital: "Hola", lat: -1.5, lng: 40.0333, towns: ["Garsen", "Bura"] },
  { county: "Lamu", capital: "Lamu", lat: -2.2717, lng: 40.902, towns: ["Mpeketoni", "Witu"] },
  { county: "Taita Taveta", capital: "Voi", lat: -3.3961, lng: 38.5561, towns: ["Taveta", "Wundanyi", "Mwatate"] },
  { county: "Garissa", capital: "Garissa", lat: -0.4536, lng: 39.6461, towns: ["Dadaab", "Masalani"] },
  { county: "Wajir", capital: "Wajir", lat: 1.7471, lng: 40.0573, towns: ["Habaswein", "Griftu"] },
  { county: "Mandera", capital: "Mandera", lat: 3.9366, lng: 41.867, towns: ["Elwak", "Rhamu"] },
  { county: "Marsabit", capital: "Marsabit", lat: 2.3284, lng: 37.9899, towns: ["Moyale", "Laisamis"] },
  { county: "Isiolo", capital: "Isiolo", lat: 0.3546, lng: 37.5822, towns: ["Merti", "Garbatulla"] },
  { county: "Meru", capital: "Meru", lat: 0.0515, lng: 37.6456, towns: ["Maua", "Nkubu", "Timau"] },
  { county: "Tharaka Nithi", capital: "Chuka", lat: -0.3333, lng: 37.65, towns: ["Marimanti"] },
  { county: "Embu", capital: "Embu", lat: -0.5389, lng: 37.4575, towns: ["Runyenjes", "Siakago"] },
  { county: "Kitui", capital: "Kitui", lat: -1.3667, lng: 38.0106, towns: ["Mwingi", "Mutomo"] },
  { county: "Machakos", capital: "Machakos", lat: -1.5177, lng: 37.2634, towns: ["Athi River", "Kangundo", "Matuu"] },
  { county: "Makueni", capital: "Wote", lat: -1.7833, lng: 37.6167, towns: ["Emali", "Makindu", "Kibwezi", "Mtito Andei"] },
  { county: "Nyandarua", capital: "Ol Kalou", lat: -0.2667, lng: 36.3833, towns: ["Njabini", "Engineer"] },
  { county: "Nyeri", capital: "Nyeri", lat: -0.4201, lng: 36.9476, towns: ["Karatina", "Othaya", "Naro Moru"] },
  { county: "Kirinyaga", capital: "Kerugoya", lat: -0.4989, lng: 37.28, towns: ["Sagana", "Kutus"] },
  { county: "Murang'a", capital: "Murang'a", lat: -0.7167, lng: 37.15, towns: ["Kenol", "Kangema", "Maragua"] },
  { county: "Kiambu", capital: "Kiambu", lat: -1.1714, lng: 36.8356, towns: ["Thika", "Ruiru", "Limuru", "Kikuyu", "Juja"] },
  { county: "Turkana", capital: "Lodwar", lat: 3.1191, lng: 35.5972, towns: ["Kakuma", "Lokichogio"] },
  { county: "West Pokot", capital: "Kapenguria", lat: 1.2389, lng: 35.1119, towns: ["Makutano", "Chepareria"] },
  { county: "Samburu", capital: "Maralal", lat: 1.0968, lng: 36.6987, towns: ["Baragoi", "Archers Post"] },
  { county: "Trans Nzoia", capital: "Kitale", lat: 1.0157, lng: 35.0062, towns: ["Kiminini", "Endebess"] },
  { county: "Uasin Gishu", capital: "Eldoret", lat: 0.5143, lng: 35.2698, towns: ["Burnt Forest", "Turbo", "Moi's Bridge"] },
  { county: "Elgeyo Marakwet", capital: "Iten", lat: 0.6704, lng: 35.5085, towns: ["Kapsowar", "Chepkorio"] },
  { county: "Nandi", capital: "Kapsabet", lat: 0.2028, lng: 35.1053, towns: ["Nandi Hills", "Mosoriot"] },
  { county: "Baringo", capital: "Kabarnet", lat: 0.4919, lng: 35.7431, towns: ["Eldama Ravine", "Marigat"] },
  { county: "Laikipia", capital: "Nanyuki", lat: 0.0167, lng: 37.0723, towns: ["Nyahururu", "Rumuruti"] },
  { county: "Nakuru", capital: "Nakuru", lat: -0.3031, lng: 36.08, towns: ["Naivasha", "Molo", "Gilgil", "Njoro", "Salgaa"] },
  { county: "Narok", capital: "Narok", lat: -1.0833, lng: 35.8667, towns: ["Kilgoris", "Ntulele", "Sekenani"] },
  { county: "Kajiado", capital: "Kajiado", lat: -1.8522, lng: 36.7767, towns: ["Kitengela", "Ngong", "Namanga", "Loitokitok"] },
  { county: "Kericho", capital: "Kericho", lat: -0.3689, lng: 35.2861, towns: ["Litein", "Kipkelion", "Londiani"] },
  { county: "Bomet", capital: "Bomet", lat: -0.7833, lng: 35.3417, towns: ["Sotik", "Longisa"] },
  { county: "Kakamega", capital: "Kakamega", lat: 0.2827, lng: 34.7519, towns: ["Mumias", "Malava", "Butere"] },
  { county: "Vihiga", capital: "Vihiga", lat: 0.0667, lng: 34.7167, towns: ["Mbale", "Luanda"] },
  { county: "Bungoma", capital: "Bungoma", lat: 0.5635, lng: 34.5606, towns: ["Webuye", "Kimilili", "Chwele"] },
  { county: "Busia", capital: "Busia", lat: 0.4608, lng: 34.1115, towns: ["Malaba", "Nambale", "Port Victoria"] },
  { county: "Siaya", capital: "Siaya", lat: 0.0607, lng: 34.2881, towns: ["Bondo", "Ugunja", "Yala"] },
  { county: "Kisumu", capital: "Kisumu", lat: -0.0917, lng: 34.768, towns: ["Ahero", "Maseno", "Muhoroni"] },
  { county: "Homa Bay", capital: "Homa Bay", lat: -0.5273, lng: 34.457, towns: ["Oyugis", "Kendu Bay", "Mbita"] },
  { county: "Migori", capital: "Migori", lat: -1.0634, lng: 34.4731, towns: ["Rongo", "Awendo", "Isebania"] },
  { county: "Kisii", capital: "Kisii", lat: -0.6817, lng: 34.7667, towns: ["Ogembo", "Suneka"] },
  { county: "Nyamira", capital: "Nyamira", lat: -0.5633, lng: 34.9358, towns: ["Keroka", "Nyansiongo"] },
  { county: "Nairobi", capital: "Nairobi", lat: -1.2864, lng: 36.8172, towns: ["Westlands", "Karen", "Embakasi"] },
];

/** Named terminals long-distance coaches actually depart from. */
export const TERMINALS: SeedLocation[] = [
  { name: "Machakos Country Bus Station", type: "TERMINAL", county: "Nairobi", latitude: -1.2833, longitude: 36.8333, aliases: ["Machakos Airport", "Country Bus"] },
  { name: "Railways Bus Terminus", type: "TERMINAL", county: "Nairobi", latitude: -1.2921, longitude: 36.8272, aliases: ["Railways"] },
  { name: "River Road Terminus", type: "TERMINAL", county: "Nairobi", latitude: -1.2833, longitude: 36.8281, aliases: ["River Road"] },
  { name: "Nyamakima Stage", type: "TERMINAL", county: "Nairobi", latitude: -1.2812, longitude: 36.8296 },
  { name: "Mombasa Bus Terminus", type: "TERMINAL", county: "Mombasa", latitude: -4.0512, longitude: 39.6669 },
  { name: "Kisumu Bus Park", type: "TERMINAL", county: "Kisumu", latitude: -0.0995, longitude: 34.7561 },
  { name: "Eldoret Bus Terminus", type: "TERMINAL", county: "Uasin Gishu", latitude: 0.5167, longitude: 35.2833 },
  { name: "Nakuru Bus Station", type: "TERMINAL", county: "Nakuru", latitude: -0.2833, longitude: 36.0667 },
  { name: "Kakamega Bus Park", type: "TERMINAL", county: "Kakamega", latitude: 0.2833, longitude: 34.75 },
  { name: "Kisii Bus Park", type: "TERMINAL", county: "Kisii", latitude: -0.6833, longitude: 34.7667 },
  { name: "Meru Bus Station", type: "TERMINAL", county: "Meru", latitude: 0.05, longitude: 37.65 },
  { name: "Nyeri Bus Station", type: "TERMINAL", county: "Nyeri", latitude: -0.42, longitude: 36.9476 },
];

/** Border crossings on the routes served. */
export const BORDERS: SeedLocation[] = [
  { name: "Namanga Border", type: "BORDER", county: "Kajiado", latitude: -2.5453, longitude: 36.7889, aliases: ["Namanga"] },
  { name: "Malaba Border", type: "BORDER", county: "Busia", latitude: 0.6367, longitude: 34.28, aliases: ["Malaba"] },
  { name: "Busia Border", type: "BORDER", county: "Busia", latitude: 0.4608, longitude: 34.1115 },
  { name: "Isebania Border", type: "BORDER", county: "Migori", latitude: -1.2333, longitude: 34.4833, aliases: ["Sirare"] },
  { name: "Lunga Lunga Border", type: "BORDER", county: "Kwale", latitude: -4.5567, longitude: 39.1231 },
  { name: "Taveta Border", type: "BORDER", county: "Taita Taveta", latitude: -3.3989, longitude: 37.6803 },
  { name: "Moyale Border", type: "BORDER", county: "Marsabit", latitude: 3.5167, longitude: 39.05 },
  { name: "Nadapal Border", type: "BORDER", county: "Turkana", latitude: 4.8667, longitude: 34.0667 },
];

/** East African destinations served by Kenyan long-distance operators. */
export const INTERNATIONAL: SeedLocation[] = [
  // Tanzania
  { name: "Arusha", type: "CITY", country: "TZ", latitude: -3.3869, longitude: 36.683 },
  { name: "Moshi", type: "CITY", country: "TZ", latitude: -3.3349, longitude: 37.3406 },
  { name: "Dar es Salaam", type: "CITY", country: "TZ", latitude: -6.7924, longitude: 39.2083, aliases: ["Dar"] },
  { name: "Zanzibar", type: "CITY", country: "TZ", latitude: -6.1659, longitude: 39.2026, aliases: ["Unguja", "Stone Town"] },
  { name: "Tanga", type: "CITY", country: "TZ", latitude: -5.0689, longitude: 39.0988 },
  { name: "Mwanza", type: "CITY", country: "TZ", latitude: -2.5164, longitude: 32.9175 },
  { name: "Dodoma", type: "CITY", country: "TZ", latitude: -6.163, longitude: 35.7516 },
  // Uganda
  { name: "Kampala", type: "CITY", country: "UG", latitude: 0.3476, longitude: 32.5825 },
  { name: "Jinja", type: "CITY", country: "UG", latitude: 0.4244, longitude: 33.2041 },
  { name: "Entebbe", type: "CITY", country: "UG", latitude: 0.0512, longitude: 32.4637 },
  { name: "Mbale", type: "TOWN", country: "UG", latitude: 1.0644, longitude: 34.1797 },
  { name: "Gulu", type: "CITY", country: "UG", latitude: 2.7746, longitude: 32.2989 },
  // Rwanda
  { name: "Kigali", type: "CITY", country: "RW", latitude: -1.9441, longitude: 30.0619 },
  { name: "Musanze", type: "TOWN", country: "RW", latitude: -1.4996, longitude: 29.6344 },
  // Burundi
  { name: "Bujumbura", type: "CITY", country: "BI", latitude: -3.3614, longitude: 29.3599 },
  // South Sudan
  { name: "Juba", type: "CITY", country: "SS", latitude: 4.8594, longitude: 31.5713 },
];

export const COUNTRY_NAME: Record<string, string> = {
  KE: "Kenya",
  TZ: "Tanzania",
  UG: "Uganda",
  RW: "Rwanda",
  BI: "Burundi",
  SS: "South Sudan",
};

/** Builds the full location list from the county table plus the extras above. */
export function buildLocations(): SeedLocation[] {
  const out: SeedLocation[] = [];
  const seen = new Set<string>();

  const add = (loc: SeedLocation) => {
    const key = `${loc.name}|${loc.country ?? "KE"}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(loc);
  };

  for (const c of COUNTIES) {
    // The county itself.
    add({
      name: `${c.county} County`,
      type: "COUNTY",
      county: c.county,
      country: "KE",
      latitude: c.lat,
      longitude: c.lng,
      aliases: [c.county],
    });

    // Its headquarters, which is the bookable place.
    add({
      name: c.capital,
      type: c.county === "Nairobi" || c.county === "Mombasa" || c.county === "Kisumu" ? "CITY" : "TOWN",
      county: c.county,
      country: "KE",
      latitude: c.lat,
      longitude: c.lng,
    });

    for (const town of c.towns) {
      add({ name: town, type: "TOWN", county: c.county, country: "KE" });
    }
  }

  for (const t of TERMINALS) add({ ...t, country: "KE" });
  for (const b of BORDERS) add({ ...b, country: "KE" });
  for (const i of INTERNATIONAL) add(i);

  return out;
}
