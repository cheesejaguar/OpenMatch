import Link from "next/link";
import { Suspense } from "react";
import AccessReasonForm from "../../../../components/access/AccessReasonForm";
import SensitiveBanner from "../../../../components/access/SensitiveBanner";
import Skeleton from "../../../../components/ui/Skeleton";
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

// PERF-A1 / PERF-A3: conversation metadata and the message list are
// independent fetches keyed by the same conversationId. Stream the
// header + metadata card immediately, and the message list inside its
// own Suspense boundary so a slow messages query (or a 412 gate) does
// not block the page header.
export default async function ConversationPage({ params, searchParams }: Params) {
  const { conversationId } = await params;
  const sp = await searchParams;
  return (
    <div>
      <Suspense fallback={<ConversationHeaderSkeleton />}>
        <ConversationHeader conversationId={conversationId} />
      </Suspense>
      <Suspense fallback={<MessagesSkeleton />}>
        <Messages
          conversationId={conversationId}
          accessGrantId={sp.accessGrantId}
          reportId={sp.reportId}
        />
      </Suspense>
    </div>
  );
}

function ConversationHeaderSkeleton() {
  return (
    <>
      <SensitiveBanner />
      <div className="page-header">
        <h2>
          <Skeleton width={260} height={24} />
        </h2>
      </div>
      <div className="card">
        <Skeleton height={36} />
      </div>
    </>
  );
}

async function ConversationHeader({ conversationId }: { conversationId: string }) {
  const convoRes = await adminFetch<ConversationResponse>(
    `/api/v1/admin/conversations/${conversationId}`,
  );
  if (!convoRes.ok && convoRes.status === 404) {
    return (
      <div className="page-header">
        <h2>Conversation not found</h2>
      </div>
    );
  }
  if (!convoRes.ok) {
    return (
      <>
        <div className="page-header">
          <h2>Conversation</h2>
        </div>
        <div className="error">
          Failed to load ({convoRes.status} {convoRes.error.code}).
        </div>
      </>
    );
  }
  const convo = convoRes.data;
  return (
    <>
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
    </>
  );
}

function MessagesSkeleton() {
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <Skeleton height={240} />
    </div>
  );
}

async function Messages({
  conversationId,
  accessGrantId,
  reportId,
}: {
  conversationId: string;
  accessGrantId: string | undefined;
  reportId: string | undefined;
}) {
  const msgsRes = await adminFetch<MessagesResponse>(
    `/api/v1/admin/conversations/${conversationId}/messages`,
    { query: { accessGrantId, limit: 200 } },
  );

  if (msgsRes.status === 412) {
    return (
      <div style={{ marginTop: 16 }}>
        <AccessReasonForm
          entityType="conversation"
          entityId={conversationId}
          nextPath={`/conversations/${conversationId}`}
          reportId={reportId}
        />
      </div>
    );
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      {!msgsRes.ok ? (
        <div className="error">
          Failed to load messages ({msgsRes.status} {msgsRes.error.code}).
        </div>
      ) : msgsRes.data.messages.length === 0 ? (
        <div className="muted">No messages.</div>
      ) : (
        msgsRes.data.messages.map((m) => (
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
  );
}
