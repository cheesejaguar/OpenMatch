import Link from "next/link";
import { readSession } from "../../lib/auth/session";

const NAV_ITEMS = [
  { href: "/overview", label: "Overview" },
  { href: "/users", label: "Users" },
  { href: "/reports", label: "Reports" },
  { href: "/photos", label: "Photos" },
  { href: "/audit", label: "Audit Log" },
  { href: "/settings/admins", label: "Admin Users" },
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
        {NAV_ITEMS.map((item) => (
          <Link key={item.href} href={item.href}>
            {item.label}
          </Link>
        ))}
        <form action="/api/auth/logout" method="post" style={{ marginTop: 24 }}>
          <button type="submit" style={{ width: "100%" }}>
            Sign out
          </button>
        </form>
      </nav>
    </aside>
  );
}
