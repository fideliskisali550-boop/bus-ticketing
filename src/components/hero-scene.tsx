/**
 * The landing page's hero artwork.
 *
 * Drawn rather than photographed, for two reasons. The Content-Security-Policy
 * sets `img-src 'self'`, so no external photography can load, and shipping
 * licensed stock into the repository is a licence question this project does
 * not need. An inline SVG also weighs a couple of kilobytes, scales to any
 * viewport without a second asset, and — because it is built from the theme's
 * own CSS variables — recolours itself in dark mode instead of sitting there as
 * a bright rectangle.
 *
 * The scene is deliberately abstract: layered escarpment, a road falling away
 * toward the horizon, and a low sun. Enough to read as long-distance travel
 * across Kenya without pretending to be a photograph of anywhere in particular.
 */
export function HeroScene({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 1440 520"
      preserveAspectRatio="xMidYMax slice"
      className={className}
      aria-hidden
      focusable="false"
    >
      <defs>
        {/* Sky. Stops are theme variables, so the whole scene follows the
            light/dark switch without a second copy of the artwork. */}
        <linearGradient id="hs-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="hsl(var(--brand) / 0.20)" />
          <stop offset="55%" stopColor="hsl(var(--brand) / 0.07)" />
          <stop offset="100%" stopColor="hsl(var(--bg))" />
        </linearGradient>

        <radialGradient id="hs-sun" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="hsl(var(--accent) / 0.75)" />
          <stop offset="70%" stopColor="hsl(var(--accent) / 0.18)" />
          <stop offset="100%" stopColor="hsl(var(--accent) / 0)" />
        </radialGradient>

        <linearGradient id="hs-road" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="hsl(var(--ink) / 0.14)" />
          <stop offset="100%" stopColor="hsl(var(--ink) / 0.30)" />
        </linearGradient>

        {/* Fades the far end of every layer into the sky, which is what stops
            the silhouettes reading as flat cut-out shapes. */}
        <linearGradient id="hs-haze" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="hsl(var(--bg) / 0.55)" />
          <stop offset="100%" stopColor="hsl(var(--bg) / 0)" />
        </linearGradient>
      </defs>

      <rect width="1440" height="520" fill="url(#hs-sky)" />
      <circle cx="1090" cy="235" r="190" fill="url(#hs-sun)" />

      {/* Furthest ridge — lightest, to sit back in the haze. */}
      <path
        d="M0 330 L150 292 L300 316 L455 258 L600 300 L760 246 L900 292 L1060 252 L1210 296 L1330 268 L1440 300 L1440 520 L0 520 Z"
        fill="hsl(var(--brand) / 0.20)"
      />

      {/* Middle escarpment. */}
      <path
        d="M0 386 L170 344 L340 378 L500 322 L660 366 L820 330 L980 372 L1140 336 L1300 378 L1440 350 L1440 520 L0 520 Z"
        fill="hsl(var(--brand) / 0.32)"
      />

      {/* Nearest ridge, darkest, carrying the road. Each layer is heavier than
          the one behind it — that ordering is what reads as distance. */}
      <path
        d="M0 438 L200 410 L400 440 L580 404 L760 442 L940 412 L1120 446 L1300 418 L1440 442 L1440 520 L0 520 Z"
        fill="hsl(var(--brand) / 0.46)"
      />

      <rect y="300" width="1440" height="120" fill="url(#hs-haze)" />

      {/* The road: a trapezoid narrowing to a vanishing point, with a dashed
          centre line whose gaps widen toward the viewer to sell the perspective. */}
      <path d="M690 424 L750 424 L1010 520 L430 520 Z" fill="url(#hs-road)" />
      <path
        d="M718 428 L722 428 L742 470 L716 470 Z M712 482 L748 482 L772 520 L688 520 Z"
        fill="hsl(var(--bg) / 0.75)"
      />

      {/* A few acacia silhouettes for scale against the ridgeline. */}
      {[
        { x: 250, s: 1 },
        { x: 1195, s: 0.82 },
        { x: 505, s: 0.6 },
      ].map(({ x, s }) => (
        <g key={x} transform={`translate(${x} 438) scale(${s})`} fill="hsl(var(--brand) / 0.55)">
          <rect x="-2" y="-26" width="4" height="26" />
          <ellipse cx="0" cy="-30" rx="26" ry="7" />
          <ellipse cx="-9" cy="-37" rx="14" ry="5" />
        </g>
      ))}
    </svg>
  );
}
