import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { SignOutButton } from "@/components/auth-buttons";
import { canCreateWorkspace } from "@/lib/auth";
import { requireUser, roleLabel, type Role } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { acceptInvitation, createWorkspace } from "./actions";

export default async function WorkspacesPage() {
  const user = await requireUser();

  const memberships = await prisma.membership.findMany({
    where: { userId: user.id },
    select: { role: true, workspace: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });

  // Only invitations addressed to this user's own verified email. Workspaces are never
  // listed or searchable, and there is no form to look up other emails.
  const invitations = user.emailVerified
    ? await prisma.invitation.findMany({
        where: { email: user.email.toLowerCase(), status: "pending", expiresAt: { gt: new Date() } },
        select: { id: true, role: true, workspace: { select: { name: true } } },
      })
    : [];

  const canCreate = canCreateWorkspace(user.email);
  const nothingHere = memberships.length === 0 && invitations.length === 0;

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-8">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Your workspaces</h1>
        <SignOutButton />
      </header>

      {memberships.length > 0 && (
        <ul className="flex flex-col gap-2">
          {memberships.map(({ role, workspace }) => (
            <li key={workspace.id}>
              <Link href={`/${workspace.id}`} className="underline">
                {workspace.name}
              </Link>{" "}
              <span className="text-sm text-zinc-500">({roleLabel(role as Role)})</span>
            </li>
          ))}
        </ul>
      )}

      {invitations.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Invitations</h2>
          {invitations.map((invite) => (
            <div key={invite.id} className="flex items-center gap-3">
              <span>
                {invite.workspace.name} as {roleLabel(invite.role === "owner" ? "owner" : "member")}
              </span>
              <ActionForm action={acceptInvitation} submitLabel="Join">
                <input type="hidden" name="invitationId" value={invite.id} />
              </ActionForm>
            </div>
          ))}
        </section>
      )}

      {nothingHere && !canCreate && (
        <section className="flex flex-col gap-3">
          <p>
            No workspace is linked to <strong>{user.email}</strong>. Ask your sponsorship chair to invite
            this email, or sign in with a different Google account.
          </p>
          <div>
            <SignOutButton label="Use a different account" />
          </div>
        </section>
      )}

      {canCreate && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Create a workspace</h2>
          <ActionForm action={createWorkspace} submitLabel="Create">
            <input name="name" required placeholder="Org name" aria-label="Workspace name" className="rounded border px-2 py-1" />
          </ActionForm>
        </section>
      )}
    </main>
  );
}
