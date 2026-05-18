import "./globals.css";
import localFont from "next/font/local";
import type { ReactNode } from "react";

// Geist for body / UI chrome. Loaded with style: "normal" + variable
// weights covering the four cuts we use across the dashboard.
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

// Fraunces italic is the brand wordmark + headline font. Only the
// SemiBoldItalic cut is loaded on the admin side — we don't need the
// full editorial range here, just the brand voice.
const fraunces = localFont({
  src: [
    { path: "./fonts/Fraunces9pt-Italic.ttf", weight: "400", style: "italic" },
    { path: "./fonts/Fraunces9pt-SemiBoldItalic.ttf", weight: "600", style: "italic" },
  ],
  variable: "--font-fraunces",
  display: "swap",
});

export const metadata = {
  title: "OpenMatch Admin",
  description: "OpenMatch admin dashboard",
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${fraunces.variable}`}>
      <body>{children}</body>
    </html>
  );
}
