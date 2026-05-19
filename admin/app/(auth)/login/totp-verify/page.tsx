import { redirect } from "next/navigation";
import { adminFetch } from "../../../../lib/api/admin-client";
import { readSession } from "../../../../lib/auth/session";

interface SearchParams {
  searchParams: Promise<{ next?: string; error?: string; recovery?: string }>;
}

async function submitCode(formData: FormData): Promise<void> {
  "use server";
  const code = String(formData.get("code") ?? "").trim();
  const next = String(formData.get("next") ?? "/overview");
  if (!code) {
    redirect(`/login/totp-verify?error=code_required&next=${encodeURIComponent(next)}`);
  }
  const res = await adminFetch<{ ok: boolean }>("/api/v1/admin/auth/totp/verify", {
    method: "POST",
    body: { code },
  });
  if (!res.ok) {
    redirect(
      `/login/totp-verify?error=${encodeURIComponent(res.error.code)}&next=${encodeURIComponent(next)}`,
    );
  }
  redirect(next);
}

async function submitRecoveryCode(formData: FormData): Promise<void> {
  "use server";
  const recoveryCode = String(formData.get("recoveryCode") ?? "").trim();
  const next = String(formData.get("next") ?? "/overview");
  if (!recoveryCode) {
    redirect(`/login/totp-verify?recovery=1&error=code_required&next=${encodeURIComponent(next)}`);
  }
  const res = await adminFetch<{ ok: boolean }>("/api/v1/admin/auth/totp/recover", {
    method: "POST",
    body: { recoveryCode },
  });
  if (!res.ok) {
    redirect(
      `/login/totp-verify?recovery=1&error=${encodeURIComponent(res.error.code)}&next=${encodeURIComponent(next)}`,
    );
  }
  redirect(next);
}

export default async function TotpVerifyPage({ searchParams }: SearchParams) {
  const session = await readSession();
  if (!session) redirect("/login");
  const sp = await searchParams;
  const next = sp.next ?? "/overview";
  const showRecovery = sp.recovery === "1";

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Two-factor verification</h2>
      <p className="muted">
        {showRecovery
          ? "Enter one of the recovery codes you saved when enrolling. Each code works once."
          : "Open your authenticator app and enter the 6-digit code for OpenMatch."}
      </p>
      {sp.error ? <div className="error">{sp.error}</div> : null}

      {!showRecovery ? (
        <form action={submitCode}>
          <input type="hidden" name="next" value={next} />
          <label htmlFor="code">Verification code</label>
          <input
            id="code"
            name="code"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            autoComplete="one-time-code"
            required
          />
          <button className="primary" type="submit" style={{ marginTop: 12, width: "100%" }}>
            Verify
          </button>
          <p className="muted" style={{ marginTop: 12, fontSize: 13 }}>
            Lost your device?{" "}
            <a href={`/login/totp-verify?recovery=1&next=${encodeURIComponent(next)}`}>
              Use a recovery code
            </a>
          </p>
        </form>
      ) : (
        <form action={submitRecoveryCode}>
          <input type="hidden" name="next" value={next} />
          <label htmlFor="recoveryCode">Recovery code</label>
          <input
            id="recoveryCode"
            name="recoveryCode"
            autoCapitalize="characters"
            autoComplete="off"
            required
          />
          <button className="primary" type="submit" style={{ marginTop: 12, width: "100%" }}>
            Submit recovery code
          </button>
          <p className="muted" style={{ marginTop: 12, fontSize: 13 }}>
            <a href={`/login/totp-verify?next=${encodeURIComponent(next)}`}>
              Use the authenticator app instead
            </a>
          </p>
        </form>
      )}
    </div>
  );
}
