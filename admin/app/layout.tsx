import "./globals.css";
import localFont from "next/font/local";
import type { ReactNode } from "react";

// Geist for body / UI chrome. Loaded with style: "normal" + variable
// weights covering the six cuts we use across the dashboard. Light
// (300) and Black (900) were added in Phase B of the Aurora Dawn
// overhaul so admin surfaces can build clearer hierarchy.
const geist = localFont({
  src: [
    { path: "./fonts/Geist-Light.ttf", weight: "300", style: "normal" },
    { path: "./fonts/Geist-Regular.ttf", weight: "400", style: "normal" },
    { path: "./fonts/Geist-Medium.ttf", weight: "500", style: "normal" },
    { path: "./fonts/Geist-SemiBold.ttf", weight: "600", style: "normal" },
    { path: "./fonts/Geist-Bold.ttf", weight: "700", style: "normal" },
    { path: "./fonts/Geist-Black.ttf", weight: "900", style: "normal" },
  ],
  variable: "--font-geist",
  display: "swap",
});

// Fraunces is the brand wordmark + headline font. Phase B expands the
// admin cut list to include Light (for delicate editorial moments),
// Black, and BlackItalic so the wordmark and hero numerals can land
// with the same weight as the iOS match overlay.
const fraunces = localFont({
  src: [
    { path: "./fonts/Fraunces9pt-Light.ttf", weight: "300", style: "normal" },
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
      <body>{children}</body>
    </html>
  );
}
