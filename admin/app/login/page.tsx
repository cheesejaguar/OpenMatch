import { loginAction } from "@/lib/actions/auth";
import { listAdminUsers } from "@/lib/data/store";
import { ROLES } from "@/lib/auth/permissions";
import { readSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await readSession()) redirect("/overview");
  const sp = await searchParams;
  const admins = listAdminUsers();
  return (
    <main className="min-h-screen grid place-items-center bg-ink-100">
      <div className="card p-8 max-w-md w-full">
        <div className="text-xs uppercase tracking-wider text-ink-500">OpenMatch</div>
        <h1 className="text-2xl font-semibold mt-1">Admin Console</h1>
        <p className="text-sm text-ink-500 mt-2">
          Sign in with your identity provider. This is a Phase 0 prototype that lets you sign
          in as one of the seeded admin identities to exercise role-based workflows. A
          production deployment routes this through OIDC + MFA.
        </p>
        {sp.error ? (
          <div className="mt-4 rounded-md border border-danger/30 bg-danger-soft text-danger px-3 py-2 text-sm">
            {sp.error === "invalid"
              ? "Invalid sign-in request."
              : "Unknown or disabled admin account."}
          </div>
        ) : null}
        <form action={loginAction} className="mt-5 space-y-3">
          <label className="label" htmlFor="adminUserId">
            Sign in as
          </label>
          <select id="adminUserId" name="adminUserId" required className="field">
            {admins.map((a) => (
              <option key={a.id} value={a.id}>
                {a.displayName} — {a.roles.map((r) => ROLES[r].label).join(", ")}
              </option>
            ))}
          </select>
          <button type="submit" className="btn-primary w-full justify-center">
            Continue
          </button>
        </form>
        <div className="mt-6 text-xs text-ink-500">
          By signing in you agree that admin actions are logged and reviewable. See PRD §10.3.
        </div>
      </div>
    </main>
  );
}
