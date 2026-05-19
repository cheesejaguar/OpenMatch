import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { adminFetch } from "../../../../lib/api/admin-client";
import { readSession } from "../../../../lib/auth/session";

interface SearchParams {
  searchParams: Promise<{ next?: string; codes?: string; uri?: string; error?: string }>;
}

interface EnrollResponse {
  otpauthUri: string;
  recoveryCodes: string[];
}

// Server action: triggers the backend enrolment, then redirects back to
// this page with the secret URI + one-time recovery codes encoded into
// search params. They survive a single render and are not persisted to
// the session cookie — the admin must capture them before navigating
// away.
async function startEnroll(formData: FormData): Promise<void> {
  "use server";
  const next = String(formData.get("next") ?? "/overview");
  const res = await adminFetch<EnrollResponse>("/api/v1/admin/auth/totp/enroll", {
    method: "POST",
    body: {},
  });
  if (!res.ok) {
    redirect(
      `/login/totp-enroll?error=${encodeURIComponent(res.error.code)}&next=${encodeURIComponent(next)}`,
    );
  }
  const params = new URLSearchParams();
  params.set("uri", res.data.otpauthUri);
  params.set("codes", res.data.recoveryCodes.join(","));
  params.set("next", next);
  redirect(`/login/totp-enroll?${params.toString()}`);
}

async function submitCode(formData: FormData): Promise<void> {
  "use server";
  const code = String(formData.get("code") ?? "").trim();
  const next = String(formData.get("next") ?? "/overview");
  if (!code) {
    redirect(`/login/totp-enroll?error=code_required&next=${encodeURIComponent(next)}`);
  }
  const res = await adminFetch<{ ok: boolean }>("/api/v1/admin/auth/totp/verify", {
    method: "POST",
    body: { code },
  });
  if (!res.ok) {
    redirect(
      `/login/totp-enroll?error=${encodeURIComponent(res.error.code)}&next=${encodeURIComponent(next)}`,
    );
  }
  redirect(next);
}

export default async function TotpEnrollPage({ searchParams }: SearchParams) {
  const session = await readSession();
  if (!session) redirect("/login");
  const sp = await searchParams;
  const next = sp.next ?? "/overview";
  const enrolled = Boolean(sp.uri && sp.codes);

  let qrDataUri: string | null = null;
  if (sp.uri) {
    qrDataUri = await QRCode.toDataURL(sp.uri, { errorCorrectionLevel: "M", margin: 1 });
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Set up two-factor authentication</h2>
      <p className="muted">
        OpenMatch admins must enrol a TOTP authenticator (Google Authenticator, 1Password, Authy,
        etc.) before reaching the dashboard. You&apos;ll be asked for a 6-digit code on every new
        sign-in.
      </p>
      {sp.error ? <div className="error">{sp.error}</div> : null}

      {!enrolled ? (
        <form action={startEnroll}>
          <input type="hidden" name="next" value={next} />
          <button className="primary" type="submit">
            Generate secret
          </button>
        </form>
      ) : null}

      {enrolled && qrDataUri ? (
        <div style={{ marginTop: 20 }}>
          <h3>1. Scan this QR code</h3>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrDataUri}
            alt="TOTP enrolment QR code"
            width={220}
            height={220}
            style={{ display: "block", marginBottom: 8 }}
          />
          <p className="muted" style={{ fontSize: 13 }}>
            Or paste this secret into your authenticator app:&nbsp;
            <code>{new URL(sp.uri!).searchParams.get("secret")}</code>
          </p>

          <h3>2. Save your recovery codes</h3>
          <p className="muted">
            Store these somewhere safe — they let you sign in if you lose your authenticator. Each
            code works once. <strong>This is the only time they&apos;ll be shown.</strong>
          </p>
          <ul
            className="recovery-codes"
            style={{
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: 14,
              lineHeight: 1.7,
              listStyle: "none",
              padding: 12,
              border: "1px solid var(--border)",
              borderRadius: 6,
              background: "var(--bg-muted, #f8f8f6)",
            }}
          >
            {sp.codes!.split(",").map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>

          <h3>3. Enter a 6-digit code from your app</h3>
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
              Verify and continue
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
