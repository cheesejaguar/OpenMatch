import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth/session";

export default async function RootPage() {
  const session = await readSession();
  redirect(session ? "/overview" : "/login");
}
