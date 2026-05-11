import Link from "next/link";
import SensitiveBanner from "../../../../../components/access/SensitiveBanner";
import { adminFetch } from "../../../../../lib/api/admin-client";

export const dynamic = "force-dynamic";

interface ConversationsResponse {
  conversations: Array<{
    conversationId: string;
    matchId: string;
    otherUserId: string;
    messageCount: number;
    lastMessageAt: string | null;
    status: string;
  }>;
}

interface Params {
  params: Promise<{ userId: string }>;
}

export default async function UserMessagesPage({ params }: Params) {
  const { userId } = await params;
  const { data, status } = await adminFetch<ConversationsResponse>(
    `/api/v1/admin/users/${userId}/conversations`,
  );

  return (
    <div>
      <SensitiveBanner />
      <div className="page-header">
        <h2>Conversations for {userId}</h2>
        <Link href={`/users/${userId}`}>← Back to user</Link>
      </div>
      {status !== 200 ? (
        <div className="error">Failed to load ({status}).</div>
      ) : data.conversations.length === 0 ? (
        <div className="card muted">No conversations.</div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Conversation</th>
                <th>Other user</th>
                <th>Messages</th>
                <th>Last activity</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.conversations.map((c) => (
                <tr key={c.conversationId}>
                  <td>
                    <Link href={`/conversations/${c.conversationId}`}>{c.conversationId}</Link>
                  </td>
                  <td>
                    <Link href={`/users/${c.otherUserId}`}>{c.otherUserId}</Link>
                  </td>
                  <td>{c.messageCount}</td>
                  <td className="muted">{c.lastMessageAt?.slice(0, 16) ?? "—"}</td>
                  <td>
                    <span className={`badge ${c.status}`}>{c.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
