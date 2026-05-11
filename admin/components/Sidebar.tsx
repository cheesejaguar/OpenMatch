import Link from "next/link";
import { logoutAction } from "@/lib/actions/auth";
import type { AdminSession } from "@/lib/auth/session";
import { ROLES } from "@/lib/auth/permissions";

const NAV: Array<{ href: string; label: string; permission?: string }> = [
  { href: "/overview", label: "Overview" },
  { href: "/users", label: "Users", permission: "user.read.summary" },
  { href: "/reports", label: "Reports", permission: "report.read.all" },
  { href: "/messages", label: "Messages", permission: "message.read.report_context" },
  { href: "/photos", label: "Photos", permission: "photo.read.report_context" },
  { href: "/audit", label: "Audit Logs", permission: "audit.read" },
  { href: "/settings", label: "Settings" },
];

export function Sidebar({ session }: { session: AdminSession }) {
  return (
    <aside className="w-60 shrink-0 bg-ink-900 text-ink-100 flex flex-col">
      <div className="px-5 py-5 border-b border-ink-800">
        <div className="text-sm uppercase tracking-wider text-ink-400">OpenMatch</div>
        <div className="text-lg font-semibold">Admin Console</div>
      </div>
      <nav className="flex-1 py-4">
        {NAV.filter((n) => !n.permission || session.permissions.has(n.permission as never)).map(
          (n) => (
            <Link
              key={n.href}
              href={n.href}
              className="block px-5 py-2 text-sm hover:bg-ink-800 hover:text-white !text-ink-100 no-underline"
            >
              {n.label}
            </Link>
          ),
        )}
      </nav>
      <div className="border-t border-ink-800 p-4 text-xs">
        <div className="font-medium text-white">{session.displayName}</div>
        <div className="text-ink-400">{session.email}</div>
        <div className="mt-1 flex flex-wrap gap-1">
          {session.roles.map((r) => (
            <span key={r} className="badge bg-ink-800 text-ink-200 border border-ink-700">
              {ROLES[r].label}
            </span>
          ))}
        </div>
        <form action={logoutAction} className="mt-3">
          <button type="submit" className="text-ink-300 hover:text-white underline">
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
