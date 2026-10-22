import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { SignOutButton } from "@/components/auth-buttons";
import { AuthzError, requireMembership, roleLabel } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { inviteMember } from "./actions";

export default async function WorkspacePage({ params }: PageProps<"/[workspaceId]">) {
  const { workspaceId } = await params;

  // Not a member looks the same as "doesn't exist", so workspace ids can't be probed.
  const membership = await requireMembership(workspaceId).catch((e) => {
    if (e instanceof AuthzError) notFound();
    throw e;
  });

  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: { name: true },
  });
  const isOwner = membership.role === "owner";
  const pending = isOwner
    ? await prisma.invitation.findMany({
        where: { workspaceId, status: "pending", expiresAt: { gt: new Date() } },
        select: { id: true, email: true, role: true },
        orderBy: { createdAt: "desc" },
      })
    : [];

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-8">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{workspace.name}</h1>
          <p className="text-sm text-zinc-500">You are {roleLabel(membership.role)}</p>
        </div>
        <div className="flex gap-2">
          <Link href="/workspaces" className="rounded border px-3 py-1">
            Switch workspace
          </Link>
          <SignOutButton />
        </div>
      </header>

      {isOwner && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Invite by email</h2>
          <p className="text-sm text-zinc-500">
            No email is sent. Tell them to sign in with this Google email and click Join.
          </p>
          <ActionForm action={inviteMember} submitLabel="Invite" successMessage="Invitation created.">
            <input type="hidden" name="workspaceId" value={workspaceId} />
            <input name="email" type="email" required placeholder="name@purdue.edu" aria-label="Email" className="rounded border px-2 py-1" />
            <select name="role" defaultValue="member" aria-label="Role" className="rounded border px-2 py-1">
              <option value="member">Officer</option>
              <option value="owner">Owner</option>
            </select>
          </ActionForm>
          {pending.length > 0 && (
            <ul className="text-sm">
              {pending.map((invite) => (
                <li key={invite.id}>
                  {invite.email}: {roleLabel(invite.role === "owner" ? "owner" : "member")}, pending
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}
