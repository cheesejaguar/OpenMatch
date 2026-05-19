"use client";

import { useState, useTransition } from "react";
import { createInviteBatch } from "../../server/actions/invites";

// Client component — opens a modal for generating a batch of invite
// codes. State is local; on success we surface the codes inline with
// per-row copy buttons. The server action handles validation + the
// authenticated POST to /api/v1/admin/invites.

interface CreatedItem {
  id: string;
  code: string;
  cohortLabel: string;
  maxUses: number;
  expiresAt: string | null;
}

export default function GenerateBatchModal() {
  const [open, setOpen] = useState(false);
  const [cohort, setCohort] = useState("");
  const [count, setCount] = useState(5);
  const [maxUses, setMaxUses] = useState(1);
  const [expiresAt, setExpiresAt] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedItem[]>([]);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  function reset() {
    setCohort("");
    setCount(5);
    setMaxUses(1);
    setExpiresAt("");
    setNotes("");
    setError(null);
    setCreated([]);
    setCopiedCode(null);
  }

  function close() {
    setOpen(false);
    reset();
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await createInviteBatch({
        cohortLabel: cohort,
        count,
        maxUses,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        notes,
      });
      if (!res.ok) {
        setError(res.error ?? `Server returned ${res.status}`);
        return;
      }
      setCreated(res.items ?? []);
    });
  }

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode((c) => (c === code ? null : c)), 1500);
    } catch {
      // Clipboard API can fail in older or insecure contexts — surface
      // a noisy error in the console rather than failing silently.
      console.warn("clipboard.writeText failed");
    }
  }

  async function copyAll() {
    if (created.length === 0) return;
    const all = created.map((c) => c.code).join("\n");
    try {
      await navigator.clipboard.writeText(all);
      setCopiedCode("__all__");
      setTimeout(() => setCopiedCode((c) => (c === "__all__" ? null : c)), 1500);
    } catch {
      console.warn("clipboard.writeText failed");
    }
  }

  return (
    <>
      <button type="button" className="primary" onClick={() => setOpen(true)}>
        Generate batch
      </button>
      {open ? (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="invite-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") close();
          }}
        >
          <div className="modal">
            <h3 id="invite-modal-title">Generate invite codes</h3>
            {created.length === 0 ? (
              <form onSubmit={submit}>
                <div style={{ display: "grid", gap: 10 }}>
                  <div>
                    <label htmlFor="cohort">Cohort label</label>
                    <input
                      id="cohort"
                      required
                      value={cohort}
                      onChange={(e) => setCohort(e.target.value)}
                      placeholder="e.g. sf-bay-wave-1"
                    />
                  </div>
                  <div className="grid cols-2">
                    <div>
                      <label htmlFor="count">Count</label>
                      <input
                        id="count"
                        type="number"
                        min={1}
                        max={100}
                        value={count}
                        onChange={(e) => setCount(Number(e.target.value))}
                      />
                    </div>
                    <div>
                      <label htmlFor="maxUses">Max uses per code</label>
                      <input
                        id="maxUses"
                        type="number"
                        min={1}
                        max={1000}
                        value={maxUses}
                        onChange={(e) => setMaxUses(Number(e.target.value))}
                      />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="expiresAt">Expires at (optional)</label>
                    <input
                      id="expiresAt"
                      type="datetime-local"
                      value={expiresAt}
                      onChange={(e) => setExpiresAt(e.target.value)}
                    />
                  </div>
                  <div>
                    <label htmlFor="notes">Notes (optional)</label>
                    <textarea
                      id="notes"
                      rows={3}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                    />
                  </div>
                </div>
                {error ? <div className="error">{error}</div> : null}
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
                  <button type="button" onClick={close}>
                    Cancel
                  </button>
                  <button type="submit" className="primary" disabled={pending}>
                    {pending ? "Generating…" : "Generate"}
                  </button>
                </div>
              </form>
            ) : (
              <>
                <p className="muted" style={{ marginTop: 0 }}>
                  Generated {created.length} code{created.length === 1 ? "" : "s"}. Copy them now —
                  the underlying secret won't be shown again.
                </p>
                <div
                  style={{
                    maxHeight: 280,
                    overflowY: "auto",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius)",
                  }}
                >
                  {created.map((c) => (
                    <div
                      key={c.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "8px 12px",
                        borderBottom: "1px solid var(--border)",
                      }}
                    >
                      <code style={{ flex: 1, fontFamily: "var(--mono)" }}>{c.code}</code>
                      <button type="button" onClick={() => copy(c.code)}>
                        {copiedCode === c.code ? "Copied" : "Copy"}
                      </button>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
                  <button type="button" onClick={copyAll}>
                    {copiedCode === "__all__" ? "Copied all" : "Copy all"}
                  </button>
                  <button type="button" className="primary" onClick={close}>
                    Done
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
