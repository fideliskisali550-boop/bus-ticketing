import type { Config } from "tailwindcss";

/**
 * Colour is expressed as CSS custom properties in globals.css rather than
 * literal hex values here, so that the dark theme is a variable swap on <html>
 * instead of a parallel set of `dark:` utilities on every element.
 */
const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "hsl(var(--bg) / <alpha-value>)",
        surface: "hsl(var(--surface) / <alpha-value>)",
        elevated: "hsl(var(--elevated) / <alpha-value>)",
        line: "hsl(var(--line) / <alpha-value>)",
        ink: "hsl(var(--ink) / <alpha-value>)",
        muted: "hsl(var(--muted) / <alpha-value>)",
        brand: {
          DEFAULT: "hsl(var(--brand) / <alpha-value>)",
          soft: "hsl(var(--brand-soft) / <alpha-value>)",
          ink: "hsl(var(--brand-ink) / <alpha-value>)",
        },
        accent: "hsl(var(--accent) / <alpha-value>)",
        ok: "hsl(var(--ok) / <alpha-value>)",
        warn: "hsl(var(--warn) / <alpha-value>)",
        danger: "hsl(var(--danger) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        card: "16px",
      },
      boxShadow: {
        /* Soft and cool: a hairline plus a wide, low-opacity ambient shadow, so
           cards read as gently lifted off the canvas rather than boxed by a
           hard drop shadow. */
        card: "0 1px 2px hsl(var(--shadow) / 0.04), 0 6px 20px -12px hsl(var(--shadow) / 0.16)",
        lift: "0 2px 6px hsl(var(--shadow) / 0.06), 0 20px 44px -20px hsl(var(--shadow) / 0.26)",
        /* A tinted glow for the primary action and active nav, the detail that
           reads as "premium SaaS" rather than "default button". */
        brand: "0 6px 18px -6px hsl(var(--brand) / 0.45)",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.3s cubic-bezier(0.22, 1, 0.36, 1) both",
        shimmer: "shimmer 1.6s infinite",
      },
    },
  },
  plugins: [],
};

export default config;
