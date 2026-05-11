import { Sidebar } from "@/components/Sidebar";
import { requireSession } from "@/lib/auth/session";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  return (
    <div className="min-h-screen flex">
      <Sidebar session={session} />
      <main className="flex-1 px-8 py-6 overflow-x-auto">{children}</main>
    </div>
  );
}
