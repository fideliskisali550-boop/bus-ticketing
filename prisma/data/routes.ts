/**
 * The route network, with fares taken from what operators actually charge.
 *
 * `baseFare` is the economy walk-up rate on that corridor at the time of
 * writing. These are market rates, not computed values — see src/lib/fares.ts
 * for why that distinction matters. VIP and Executive prices are derived from
 * these by the fare engine, so only the economy anchor is stored here.
 *
 * Where a range is commonly quoted, the mid-point is used:
 *   Nakuru–Nairobi    KES 400–600     → 500
 *   Nairobi–Mombasa   KES 1,500–2,000 → 1,700
 *   Kisumu–Nairobi    KES 1,200–1,800 → 1,400
 *   Eldoret–Nairobi   KES 1,000–1,500 → 1,200
 */

export type SeedRoute = {
  origin: string;
  destination: string;
  distanceKm: number;
  durationMin: number;
  baseFare: number;
  stops: string[];
  isInternational?: boolean;
  /** How many services a day this corridor typically runs. */
  frequency?: "high" | "medium" | "low";
};

export const ROUTES: SeedRoute[] = [
  // ---------------------------------------------------------------- Northern
  // corridor: Nairobi to the coast. The busiest long-distance corridor.
  { origin: "Nairobi", destination: "Mombasa", distanceKm: 485, durationMin: 480, baseFare: 1700, stops: ["Mtito Andei", "Voi", "Mariakani"], frequency: "high" },
  { origin: "Mombasa", destination: "Nairobi", distanceKm: 485, durationMin: 480, baseFare: 1700, stops: ["Mariakani", "Voi", "Mtito Andei"], frequency: "high" },
  { origin: "Nairobi", destination: "Malindi", distanceKm: 610, durationMin: 600, baseFare: 2000, stops: ["Voi", "Mombasa", "Kilifi"], frequency: "medium" },
  { origin: "Malindi", destination: "Nairobi", distanceKm: 610, durationMin: 600, baseFare: 2000, stops: ["Kilifi", "Mombasa", "Voi"], frequency: "medium" },
  { origin: "Nairobi", destination: "Voi", distanceKm: 330, durationMin: 300, baseFare: 1000, stops: ["Mtito Andei"], frequency: "medium" },
  { origin: "Mombasa", destination: "Malindi", distanceKm: 120, durationMin: 150, baseFare: 400, stops: ["Kilifi"], frequency: "high" },
  { origin: "Malindi", destination: "Mombasa", distanceKm: 120, durationMin: 150, baseFare: 400, stops: ["Kilifi"], frequency: "high" },
  { origin: "Mombasa", destination: "Lamu", distanceKm: 340, durationMin: 420, baseFare: 1300, stops: ["Kilifi", "Malindi", "Garsen"], frequency: "low" },
  { origin: "Nairobi", destination: "Ukunda", distanceKm: 520, durationMin: 540, baseFare: 1800, stops: ["Voi", "Mombasa", "Likoni"], frequency: "low" },

  // ---------------------------------------------------------- Western corridor
  { origin: "Nairobi", destination: "Nakuru", distanceKm: 157, durationMin: 150, baseFare: 500, stops: ["Naivasha", "Gilgil"], frequency: "high" },
  { origin: "Nakuru", destination: "Nairobi", distanceKm: 157, durationMin: 150, baseFare: 500, stops: ["Gilgil", "Naivasha"], frequency: "high" },
  { origin: "Nairobi", destination: "Naivasha", distanceKm: 90, durationMin: 90, baseFare: 300, stops: ["Mai Mahiu"], frequency: "high" },
  { origin: "Nairobi", destination: "Kisumu", distanceKm: 350, durationMin: 390, baseFare: 1400, stops: ["Naivasha", "Nakuru", "Kericho", "Ahero"], frequency: "high" },
  { origin: "Kisumu", destination: "Nairobi", distanceKm: 350, durationMin: 390, baseFare: 1400, stops: ["Ahero", "Kericho", "Nakuru", "Naivasha"], frequency: "high" },
  { origin: "Nairobi", destination: "Eldoret", distanceKm: 310, durationMin: 360, baseFare: 1200, stops: ["Naivasha", "Nakuru", "Salgaa", "Burnt Forest"], frequency: "high" },
  { origin: "Eldoret", destination: "Nairobi", distanceKm: 310, durationMin: 360, baseFare: 1200, stops: ["Burnt Forest", "Salgaa", "Nakuru", "Naivasha"], frequency: "high" },
  { origin: "Nairobi", destination: "Kakamega", distanceKm: 395, durationMin: 450, baseFare: 1400, stops: ["Nakuru", "Kapsabet"], frequency: "medium" },
  { origin: "Nairobi", destination: "Kitale", distanceKm: 380, durationMin: 420, baseFare: 1350, stops: ["Nakuru", "Eldoret", "Turbo"], frequency: "medium" },
  { origin: "Nairobi", destination: "Bungoma", distanceKm: 420, durationMin: 480, baseFare: 1450, stops: ["Nakuru", "Eldoret", "Webuye"], frequency: "medium" },
  { origin: "Nairobi", destination: "Busia", distanceKm: 460, durationMin: 510, baseFare: 1550, stops: ["Nakuru", "Eldoret", "Bungoma"], frequency: "medium" },
  { origin: "Nairobi", destination: "Kisii", distanceKm: 305, durationMin: 360, baseFare: 1200, stops: ["Narok", "Bomet"], frequency: "medium" },
  { origin: "Nairobi", destination: "Migori", distanceKm: 370, durationMin: 420, baseFare: 1400, stops: ["Narok", "Kisii", "Rongo"], frequency: "medium" },
  { origin: "Nairobi", destination: "Homa Bay", distanceKm: 375, durationMin: 420, baseFare: 1400, stops: ["Narok", "Kisii", "Oyugis"], frequency: "low" },
  { origin: "Nairobi", destination: "Kericho", distanceKm: 260, durationMin: 300, baseFare: 1000, stops: ["Nakuru", "Londiani"], frequency: "medium" },
  { origin: "Nairobi", destination: "Narok", distanceKm: 145, durationMin: 165, baseFare: 500, stops: ["Mai Mahiu"], frequency: "medium" },
  { origin: "Kisumu", destination: "Mombasa", distanceKm: 830, durationMin: 840, baseFare: 2500, stops: ["Kericho", "Nakuru", "Nairobi", "Voi"], frequency: "low" },
  { origin: "Eldoret", destination: "Kisumu", distanceKm: 115, durationMin: 150, baseFare: 400, stops: ["Kapsabet"], frequency: "high" },
  { origin: "Kisumu", destination: "Kakamega", distanceKm: 52, durationMin: 75, baseFare: 200, stops: ["Maseno"], frequency: "high" },
  { origin: "Nakuru", destination: "Eldoret", distanceKm: 155, durationMin: 180, baseFare: 500, stops: ["Salgaa", "Burnt Forest"], frequency: "high" },
  { origin: "Nakuru", destination: "Kisumu", distanceKm: 190, durationMin: 210, baseFare: 700, stops: ["Kericho"], frequency: "high" },

  // ----------------------------------------------------------- Mount Kenya
  { origin: "Nairobi", destination: "Nyeri", distanceKm: 150, durationMin: 180, baseFare: 500, stops: ["Thika", "Karatina"], frequency: "high" },
  { origin: "Nyeri", destination: "Nairobi", distanceKm: 150, durationMin: 180, baseFare: 500, stops: ["Karatina", "Thika"], frequency: "high" },
  { origin: "Nairobi", destination: "Meru", distanceKm: 275, durationMin: 300, baseFare: 1000, stops: ["Thika", "Embu", "Nkubu"], frequency: "high" },
  { origin: "Meru", destination: "Nairobi", distanceKm: 275, durationMin: 300, baseFare: 1000, stops: ["Nkubu", "Embu", "Thika"], frequency: "high" },
  { origin: "Nairobi", destination: "Embu", distanceKm: 180, durationMin: 195, baseFare: 600, stops: ["Thika", "Kenol"], frequency: "high" },
  { origin: "Nairobi", destination: "Nanyuki", distanceKm: 200, durationMin: 225, baseFare: 700, stops: ["Thika", "Karatina", "Naro Moru"], frequency: "medium" },
  { origin: "Nairobi", destination: "Nyahururu", distanceKm: 185, durationMin: 210, baseFare: 650, stops: ["Naivasha", "Ol Kalou"], frequency: "medium" },
  { origin: "Nairobi", destination: "Thika", distanceKm: 45, durationMin: 60, baseFare: 150, stops: ["Ruiru", "Juja"], frequency: "high" },
  { origin: "Nairobi", destination: "Murang'a", distanceKm: 85, durationMin: 105, baseFare: 300, stops: ["Thika", "Kenol"], frequency: "high" },
  { origin: "Nairobi", destination: "Kerugoya", distanceKm: 130, durationMin: 150, baseFare: 450, stops: ["Thika", "Sagana"], frequency: "medium" },
  { origin: "Nairobi", destination: "Chuka", distanceKm: 210, durationMin: 240, baseFare: 750, stops: ["Thika", "Embu"], frequency: "low" },

  // ---------------------------------------------------------- Eastern / North
  { origin: "Nairobi", destination: "Machakos", distanceKm: 65, durationMin: 90, baseFare: 200, stops: ["Athi River"], frequency: "high" },
  { origin: "Nairobi", destination: "Kitui", distanceKm: 180, durationMin: 210, baseFare: 600, stops: ["Machakos", "Matuu"], frequency: "medium" },
  { origin: "Nairobi", destination: "Garissa", distanceKm: 370, durationMin: 420, baseFare: 1400, stops: ["Thika", "Mwingi"], frequency: "medium" },
  { origin: "Nairobi", destination: "Wajir", distanceKm: 700, durationMin: 780, baseFare: 2200, stops: ["Mwingi", "Garissa", "Habaswein"], frequency: "low" },
  { origin: "Nairobi", destination: "Isiolo", distanceKm: 285, durationMin: 300, baseFare: 1000, stops: ["Thika", "Nanyuki"], frequency: "medium" },
  { origin: "Nairobi", destination: "Marsabit", distanceKm: 560, durationMin: 660, baseFare: 1900, stops: ["Nanyuki", "Isiolo"], frequency: "low" },
  { origin: "Nairobi", destination: "Lodwar", distanceKm: 700, durationMin: 840, baseFare: 2300, stops: ["Nakuru", "Eldoret", "Kitale"], frequency: "low" },
  { origin: "Nairobi", destination: "Wote", distanceKm: 130, durationMin: 165, baseFare: 450, stops: ["Machakos"], frequency: "low" },
  { origin: "Nairobi", destination: "Kajiado", distanceKm: 80, durationMin: 105, baseFare: 300, stops: ["Kitengela"], frequency: "high" },

  // ------------------------------------------------------------ International
  // Cross-border fares reflect the higher-spec coaches these corridors run and
  // the border formalities involved.
  { origin: "Nairobi", destination: "Arusha", distanceKm: 270, durationMin: 360, baseFare: 1800, stops: ["Kajiado", "Namanga Border"], isInternational: true, frequency: "high" },
  { origin: "Arusha", destination: "Nairobi", distanceKm: 270, durationMin: 360, baseFare: 1800, stops: ["Namanga Border", "Kajiado"], isInternational: true, frequency: "high" },
  { origin: "Nairobi", destination: "Moshi", distanceKm: 350, durationMin: 450, baseFare: 2200, stops: ["Namanga Border", "Arusha"], isInternational: true, frequency: "medium" },
  { origin: "Nairobi", destination: "Dar es Salaam", distanceKm: 830, durationMin: 900, baseFare: 4000, stops: ["Namanga Border", "Arusha", "Moshi", "Tanga"], isInternational: true, frequency: "medium" },
  { origin: "Mombasa", destination: "Dar es Salaam", distanceKm: 570, durationMin: 720, baseFare: 3200, stops: ["Lunga Lunga Border", "Tanga"], isInternational: true, frequency: "medium" },
  { origin: "Nairobi", destination: "Kampala", distanceKm: 660, durationMin: 720, baseFare: 2800, stops: ["Nakuru", "Eldoret", "Malaba Border", "Jinja"], isInternational: true, frequency: "high" },
  { origin: "Kampala", destination: "Nairobi", distanceKm: 660, durationMin: 720, baseFare: 2800, stops: ["Jinja", "Malaba Border", "Eldoret", "Nakuru"], isInternational: true, frequency: "high" },
  { origin: "Nairobi", destination: "Jinja", distanceKm: 580, durationMin: 630, baseFare: 2500, stops: ["Nakuru", "Eldoret", "Malaba Border"], isInternational: true, frequency: "medium" },
  { origin: "Nairobi", destination: "Entebbe", distanceKm: 700, durationMin: 780, baseFare: 3000, stops: ["Eldoret", "Malaba Border", "Kampala"], isInternational: true, frequency: "low" },
  { origin: "Kisumu", destination: "Kampala", distanceKm: 320, durationMin: 420, baseFare: 1800, stops: ["Busia Border", "Jinja"], isInternational: true, frequency: "medium" },
  { origin: "Nairobi", destination: "Kigali", distanceKm: 1150, durationMin: 1200, baseFare: 5000, stops: ["Nakuru", "Eldoret", "Malaba Border", "Kampala"], isInternational: true, frequency: "medium" },
  { origin: "Kigali", destination: "Nairobi", distanceKm: 1150, durationMin: 1200, baseFare: 5000, stops: ["Kampala", "Malaba Border", "Eldoret", "Nakuru"], isInternational: true, frequency: "medium" },
  { origin: "Nairobi", destination: "Bujumbura", distanceKm: 1350, durationMin: 1500, baseFare: 6000, stops: ["Eldoret", "Malaba Border", "Kampala", "Kigali"], isInternational: true, frequency: "low" },
  { origin: "Nairobi", destination: "Juba", distanceKm: 1200, durationMin: 1560, baseFare: 6500, stops: ["Nakuru", "Eldoret", "Kitale", "Lodwar", "Nadapal Border"], isInternational: true, frequency: "low" },
  { origin: "Nairobi", destination: "Mwanza", distanceKm: 920, durationMin: 1020, baseFare: 4200, stops: ["Narok", "Kisii", "Isebania Border"], isInternational: true, frequency: "low" },
];

/**
 * Departure times by corridor frequency.
 *
 * Spread across the day rather than clustered in the morning, so a passenger
 * searching at any hour still finds a service leaving later that day — the
 * absence of which is what made searches look broken.
 *
 * Kept deliberately modest. One operator does not run sixty corridors eight
 * times a day, and every extra departure multiplies into bookings, seats,
 * payments and tickets. An oversized dataset makes the demo slower without
 * making it more convincing.
 */
export const DEPARTURES_BY_FREQUENCY: Record<string, number[]> = {
  high: [7, 11, 15, 21],
  medium: [8, 19],
  low: [9],
};
