import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "OpenMatch Admin",
  description: "OpenMatch admin dashboard",
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
