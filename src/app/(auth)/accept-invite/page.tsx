import Link from "next/link";
import { describeInvitation } from "@/server/services/users";
import { AcceptInviteForm } from "./accept-form";

export const dynamic = "force-dynamic";

export default async function AcceptInvitePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const invitation = token ? await describeInvitation(token) : null;
  if (!token || !invitation) {
    return (
      <div className="space-y-3">
        <h1 className="text-lg font-semibold">Invitation not valid</h1>
        <p className="text-sm text-muted-foreground">This invitation link is invalid, expired, or already used. Ask an administrator to send a new invitation.</p>
        <Link href="/login" className="text-sm underline">
          Go to sign in
        </Link>
      </div>
    );
  }
  return <AcceptInviteForm token={token} email={invitation.email} defaultName={invitation.name} isAdmin={invitation.workspaceRole === "ADMINISTRATOR"} />;
}
