import { notFound } from "next/navigation";
import { formatTimestamp } from "@/lib/format";
import { listOutbox } from "@/server/services/workspace";

export const dynamic = "force-dynamic";
export const metadata = { title: "Development mail outbox" };

/**
 * Local development only: messages that would have been emailed (invitations,
 * password resets). Returns 404 unless MAIL_TRANSPORT=outbox, APP_ENV is
 * development, and the server is not a production build.
 */
export default async function OutboxPage() {
  const messages = await listOutbox();
  if (!messages) notFound();
  return (
    <main className="mx-auto max-w-3xl space-y-3 p-4">
      <h1 className="text-lg font-semibold">Development mail outbox</h1>
      <p className="rounded-md border border-warning/40 bg-warning-bg px-3 py-2 text-sm text-warning">Development only. Configure SMTP for any shared or production deployment; this page is unavailable in production builds.</p>
      {messages.length === 0 ? <p className="text-sm text-muted-foreground">No messages yet.</p> : null}
      <ul className="space-y-2">
        {messages.map((m) => (
          <li key={m.id} className="rounded-md border bg-background p-3 text-sm">
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{m.subject}</span>
              <span>to {m.to}</span>
              <span>{m.kind}</span>
              <span>{formatTimestamp(m.createdAt)}</span>
            </div>
            <pre className="mt-2 whitespace-pre-wrap break-all font-sans">{m.text}</pre>
          </li>
        ))}
      </ul>
    </main>
  );
}
