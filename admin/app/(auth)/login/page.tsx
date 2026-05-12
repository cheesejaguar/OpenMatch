import { adminPublicFetch } from "../../../lib/api/admin-client";

interface SearchParams {
  searchParams: Promise<{ next?: string; error?: string; devToken?: string; challengeId?: string }>;
}

async function startLogin(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return;
  const res = await adminPublicFetch<{ challengeId: string; devToken?: string }>(
    "/api/v1/admin/auth/start",
    { email },
  );
  const params = new URLSearchParams();
  params.set("challengeId", res.data.challengeId);
  if (res.data.devToken) params.set("devToken", res.data.devToken);
  // Redirect back to /login so the user sees confirmation; if running in
  // dev with a devToken we autopopulate the next step.
  const { redirect } = await import("next/navigation");
  redirect(`/login?${params.toString()}`);
}

export default async function LoginPage({ searchParams }: SearchParams) {
  const sp = await searchParams;
  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>OpenMatch admin sign in</h2>
      <p className="muted" style={{ marginBottom: 20 }}>
        Enter your work email. If it&apos;s on the allow-list you&apos;ll receive a sign-in link.
      </p>
      {sp.error ? <div className="error">{sp.error}</div> : null}
      {sp.challengeId && !sp.devToken ? (
        <div className="success">
          Check your email for a sign-in link. The link is valid for 10 minutes.
        </div>
      ) : null}
      {sp.challengeId && sp.devToken ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <p style={{ marginTop: 0 }}>
            <strong>Dev mode:</strong> click below to finish sign-in.
          </p>
          <a
            className="badge"
            style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
            href={`/login/callback?challengeId=${sp.challengeId}&token=${sp.devToken}`}
          >
            Continue
          </a>
        </div>
      ) : null}
      <form action={startLogin}>
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required />
        <button className="primary" type="submit" style={{ marginTop: 12, width: "100%" }}>
          Send sign-in link
        </button>
      </form>
    </div>
  );
}
