import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "OpenMatch Admin",
  description: "Internal moderation console for OpenMatch.",
  robots: { index: false, follow: false, nocache: true },
};

// Sensitive admin pages must not be cached anywhere along the path (PRD §11.3).
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
