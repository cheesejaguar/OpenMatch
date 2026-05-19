import Link from "next/link";
import { readSession } from "../../lib/auth/session";
import NavLink from "./NavLink";

// Sidebar — organized by functional area. Active highlighting lives in
// NavLink (client component) because Next.js navigation hooks like
// usePathname() are client-only. Section headings use Fraunces italic
// per design spec.

interface NavSection {
  label: string;
  items: Array<{ href: string; label: string }>;
}

const SECTIONS: NavSection[] = [
  {
    label: "Overview",
    items: [{ href: "/overview", label: "Overview" }],
  },
  {
    label: "Users",
    items: [{ href: "/users", label: "Users" }],
  },
  {
    label: "Safety",
    items: [
      { href: "/reports", label: "Reports" },
      { href: "/photos", label: "Photos" },
    ],
  },
  {
    label: "Beta",
    items: [
      { href: "/invites", label: "Invites" },
      { href: "/feedback", label: "Feedback" },
    ],
  },
  {
    label: "Analytics",
    items: [
      { href: "/analytics", label: "Analytics" },
      { href: "/geography", label: "Geography" },
    ],
  },
  {
    label: "Ops",
    items: [
      { href: "/health", label: "Health" },
      { href: "/flags", label: "Feature flags" },
      { href: "/audit", label: "Audit log" },
    ],
  },
  {
    label: "Admin",
    items: [{ href: "/settings/admins", label: "Admin users" }],
  },
];

export default async function Sidebar() {
  const session = await readSession();
  return (
    <aside className="sidebar">
      <h1>OpenMatch Admin</h1>
      <div className="who">
        {session?.email ?? "anonymous"}
        <br />
        <span style={{ fontSize: 11 }}>{session?.roles.join(", ") || "no roles"}</span>
      </div>
      <nav>
        {SECTIONS.map((section) => (
          <div key={section.label}>
            <div className="section">{section.label}</div>
            {section.items.map((item) => (
              <NavLink key={item.href} href={item.href} label={item.label} />
            ))}
          </div>
        ))}
        <form action="/api/auth/logout" method="post" style={{ marginTop: 24 }}>
          <button type="submit" style={{ width: "100%" }}>
            Sign out
          </button>
        </form>
        <div
          style={{
            marginTop: 18,
            fontSize: 10,
            color: "var(--fg-muted)",
            textAlign: "center",
          }}
        >
          <Link href="/" style={{ color: "var(--fg-muted)" }}>
            Botanic ·{" "}
            <span style={{ fontFamily: "var(--font-display)", fontStyle: "italic" }}>
              OpenMatch
            </span>
          </Link>
        </div>
      </nav>
    </aside>
  );
}
