"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// NavLink — needs to be a client component so we can call
// usePathname() to highlight the active route. The sidebar Server
// Component composes these inside its per-section blocks.
export default function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname() ?? "";
  // Treat "active" loosely: an exact match OR a child route under the
  // same top-level segment (e.g. /reports/abc still highlights Reports).
  const isExact = pathname === href;
  const isChild = href !== "/" && pathname.startsWith(`${href}/`);
  const active = isExact || isChild;
  return (
    <Link href={href} className={active ? "active" : ""} aria-current={active ? "page" : undefined}>
      {label}
    </Link>
  );
}
