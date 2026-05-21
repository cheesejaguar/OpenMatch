import "./globals.css";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import localFont from "next/font/local";
import type { ReactNode } from "react";

// Geist for body / UI chrome. Loaded with style: "normal" + the four
// cuts actually referenced by globals.css and components (400/500/600/700).
// Light (300) and Black (900) were dropped — repo-wide grep finds no
// consumer for either weight (PERF-A8).
const geist = localFont({
  src: [
    { path: "./fonts/Geist-Regular.ttf", weight: "400", style: "normal" },
    { path: "./fonts/Geist-Medium.ttf", weight: "500", style: "normal" },
    { path: "./fonts/Geist-SemiBold.ttf", weight: "600", style: "normal" },
    { path: "./fonts/Geist-Bold.ttf", weight: "700", style: "normal" },
  ],
  variable: "--font-geist",
  display: "swap",
});

// Fraunces is the brand wordmark + headline font. Sidebar's "om"
// wordmark uses Black 900 italic; the Italic/SemiBoldItalic cuts
// support inline editorial copy. Light (300) was dropped — no consumer
// in the codebase referenced it (PERF-A8).
const fraunces = localFont({
  src: [
    { path: "./fonts/Fraunces9pt-Italic.ttf", weight: "400", style: "italic" },
    { path: "./fonts/Fraunces9pt-SemiBoldItalic.ttf", weight: "600", style: "italic" },
    { path: "./fonts/Fraunces9pt-Black.ttf", weight: "900", style: "normal" },
    { path: "./fonts/Fraunces9pt-BlackItalic.ttf", weight: "900", style: "italic" },
  ],
  variable: "--font-fraunces",
  display: "swap",
});

export const metadata = {
  title: "OpenMatch Admin",
  description: "OpenMatch admin dashboard",
  icons: {
    icon: "/favicon.svg",
    apple: "/favicon.png",
    shortcut: "/favicon.png",
  },
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${fraunces.variable}`}>
      <body>
        {children}
        {/* Telemetry — RUM + Web Vitals (FCP/LCP/CLS/INP/TTFB). Both
            components are no-ops outside Vercel and don't ship any
            payload when the Vercel project hasn't opted in to the
            respective analytics product. */}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
