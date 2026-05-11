import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import Sidebar from "../../components/nav/Sidebar";
import { readSession } from "../../lib/auth/session";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await readSession();
  if (!session) redirect("/login");
  return (
    <div className="layout">
      <Sidebar />
      <main className="main">{children}</main>
    </div>
  );
}
