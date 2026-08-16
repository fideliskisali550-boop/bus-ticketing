import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";

/**
 * The interface typeface.
 *
 * `next/font` downloads Plus Jakarta Sans at build time and serves it from this
 * origin, so it loads under the `font-src 'self'` CSP with no external request
 * and no layout-shift flash. It is a geometric humanist sans — a little more
 * character than the system stack, which is most of what separates a template
 * from a product. The variable is consumed by `--font-sans` in globals.css.
 */
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  display: "swap",
});
import { getCurrentUser } from "@/lib/auth";
import { SiteHeader } from "@/components/site-header";
import { SessionProvider } from "@/components/session-provider";
import { LiveProvider } from "@/components/live";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "SafiriConnect — Book long-distance bus travel in Kenya",
    template: "%s · SafiriConnect",
  },
  description:
    "Check schedules, choose your seat and pay by M-Pesa. Online bus ticketing for Kenya's long-distance operators.",
  applicationName: "SafiriConnect",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7fc" },
    { media: "(prefers-color-scheme: dark)", color: "#0f0e1a" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Resolved on the server only to avoid a flash of the signed-out header on
  // first paint. Which account a *tab* is acting as is settled on the client,
  // because that choice travels in a header server rendering never sees.
  const session = await getCurrentUser();

  return (
    <html lang="en" className={jakarta.variable} suppressHydrationWarning>
      {/*
        Browser extensions inject attributes onto <body> before React hydrates
        — Grammarly adds data-gr-ext-installed, password managers add their own.
        React sees markup that differs from the server's and logs a hydration
        mismatch that no application change can prevent, because the DOM was
        modified by software outside the page. Suppressing the warning on this
        element treats the symptom at exactly the level where the cause lives.
      */}
      <body className="min-h-screen" suppressHydrationWarning>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {/* Keyboard users can jump the nav on every page. */}
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-brand focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
          >
            Skip to content
          </a>

          <SessionProvider
            initialUser={
              session
                ? {
                    sessionId: session.sessionId,
                    id: session.id,
                    fullName: session.fullName,
                    email: session.email,
                    role: session.role,
                    operatorId: session.operatorId,
                  }
                : null
            }
          >
            {/* One event stream for the whole page: dashboards subscribe to
                the events they care about rather than each opening a socket. */}
            <LiveProvider>
              <SiteHeader />
              <main id="main">{children}</main>
            </LiveProvider>
          </SessionProvider>

          <Toaster
            position="top-center"
            toastOptions={{
              className:
                "!bg-surface !text-ink !border !border-line !shadow-lift !rounded-card",
            }}
          />
        </ThemeProvider>
      </body>
    </html>
  );
}
