import Link from "next/link";
import AccessReasonForm from "../../../../components/access/AccessReasonForm";
import SensitiveBanner from "../../../../components/access/SensitiveBanner";
import { adminFetch } from "../../../../lib/api/admin-client";

export const dynamic = "force-dynamic";

interface ConversationResponse {
  conversationId: string;
  matchId: string;
  status: string;
  createdAt: string;
  participants: Array<{ userId: string; displayName: string | null }>;
}

interface MessagesResponse {
  messages: Array<{
    id: string;
    senderUserId: string;
    body: string;
    createdAt: string;
    deliveredAt: string | null;
    readAt: string | null;
    deletedAt: string | null;
    moderationStatus: string;
  }>;
}

interface Params {
  params: Promise<{ conversationId: string }>;
  searchParams: Promise<{ accessGrantId?: string; reportId?: string; accessError?: string }>;
}

export default async function ConversationPage({ params, searchParams }: Params) {
  const { conversationId } = await params;
  const sp = await searchParams;

  // PERF-A3: convo metadata and messages are keyed by the same
  // conversationId and don't depend on each other. The 412 access-reason
  // gate is handled below by branching on `msgsRes.status` — we just
  // need both responses to make routing decisions.
  const [convoRes, msgsRes] = await Promise.all([
    adminFetch<ConversationResponse>(
      `/api/v1/admin/conversations/${conversationId}`,
    ),
    adminFetch<MessagesResponse>(
      `/api/v1/admin/conversations/${conversationId}/messages`,
      { query: { accessGrantId: sp.accessGrantId, limit: 200 } },
    ),
  ]);
  if (!convoRes.ok && convoRes.status === 404) {
    return (
      <div>
        <div className="page-header">
          <h2>Conversation not found</h2>
        </div>
      </div>
    );
  }
  if (!convoRes.ok) {
    return (
      <div>
        <div className="page-header">
          <h2>Conversation</h2>
        </div>
        <div className="error">
          Failed to load ({convoRes.status} {convoRes.error.code}).
        </div>
      </div>
    );
  }
  const convo = convoRes.data;
  const msgs = msgsRes.ok ? msgsRes.data : null;
  const msgStatus = msgsRes.status;

  if (msgStatus === 412) {
    return (
      <div>
        <div className="page-header">
          <h2>Conversation {convo.conversationId}</h2>
          <Link href="/users">← Users</Link>
        </div>
        <AccessReasonForm
          entityType="conversation"
          entityId={convo.conversationId}
          nextPath={`/conversations/${convo.conversationId}`}
          reportId={sp.reportId}
        />
      </div>
    );
  }

  return (
    <div>
      <SensitiveBanner />
      <div className="page-header">
        <h2>
          Conversation <span className="muted">{convo.conversationId}</span>
        </h2>
        <Link href="/users">← Users</Link>
      </div>
      <div className="card">
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <div>
            <span className="muted">Status</span>{" "}
            <span className={`badge ${convo.status}`}>{convo.status}</span>
          </div>
          <div>
            <span className="muted">Participants</span>{" "}
            {convo.participants.map((p) => p.displayName ?? p.userId).join(" · ")}
          </div>
        </div>
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        {!msgsRes.ok ? (
          <div className="error">
            Failed to load messages ({msgStatus} {msgsRes.error.code}).
          </div>
        ) : msgs!.messages.length === 0 ? (
          <div className="muted">No messages.</div>
        ) : (
          msgs!.messages.map((m) => (
            <div
              key={m.id}
              className={`message ${m.moderationStatus === "restricted" ? "reported" : ""}`}
            >
              <div className="meta">
                {m.senderUserId} · {m.createdAt.slice(0, 16)}
                {m.deletedAt ? " · deleted" : ""}{" "}
                <span className={`badge ${m.moderationStatus}`}>{m.moderationStatus}</span>
              </div>
              <div style={{ whiteSpace: "pre-wrap" }}>{m.body}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
