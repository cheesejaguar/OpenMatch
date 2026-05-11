import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { SensitiveBanner } from "@/components/SensitiveBanner";
import { Empty } from "@/components/Empty";
import { hasPermission, requirePermission } from "@/lib/auth/session";
import { getUserById, listConversations, listMessagesForConversation, listReports } from "@/lib/data/store";

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await requirePermission("message.read.report_context");
  const sp = await searchParams;
  const all = listConversations();
  const reportedConvoIds = new Set(
    listReports({}).map((r) => r.conversationId).filter(Boolean) as string[],
  );
  const q = (sp.q ?? "").toLowerCase();
  const filtered = q
    ? all.filter((c) => {
        if (c.id.toLowerCase().includes(q)) return true;
        const messages = listMessagesForConversation(c.id);
        return (
          messages.some((m) => m.body.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)) ||
          c.participantUserIds.some((p) => p.toLowerCase().includes(q))
        );
      })
    : all;

  return (
    <>
      <PageHeader
        title="Messages"
        subtitle="Authorized conversation review. Each open is logged."
      />
      <SensitiveBanner>
        Messages are private user content. Opening a conversation outside a report context
        requires the <code>message.read.all</code> permission and an access reason.
      </SensitiveBanner>

      <form className="card p-4 flex gap-3 items-end mt-4 mb-4" method="get">
        <div className="grow">
          <label className="label" htmlFor="q">Search</label>
          <input
            id="q"
            name="q"
            defaultValue={sp.q ?? ""}
            className="field"
            placeholder="Conversation ID, message text, user ID…"
          />
        </div>
        <button type="submit" className="btn-primary">Search</button>
      </form>

      {filtered.length === 0 ? (
        <Empty title="No conversations match your filters." />
      ) : (
        <div className="card overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Conversation</th>
                <th>Participants</th>
                <th>Messages</th>
                <th>Status</th>
                <th>Reported?</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const msgs = listMessagesForConversation(c.id);
                const a = getUserById(c.participantUserIds[0]);
                const b = getUserById(c.participantUserIds[1]);
                return (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/conversations/${c.id}`}>{c.id}</Link>
                      {!hasPermission(session, "message.read.all") ? (
                        <div className="text-xs text-ink-500">view requires elevated role</div>
                      ) : null}
                    </td>
                    <td>
                      {a?.displayName ?? c.participantUserIds[0]} ↔{" "}
                      {b?.displayName ?? c.participantUserIds[1]}
                    </td>
                    <td>{msgs.length}</td>
                    <td>{c.status}</td>
                    <td>{reportedConvoIds.has(c.id) ? "yes" : "—"}</td>
                    <td className="text-ink-500">{new Date(c.createdAt).toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
