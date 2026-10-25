import Link from "next/link";
import { SignOutButton } from "@/components/auth-buttons";
import { requireMembershipOr404, roleLabel } from "@/lib/authz";
import { prisma } from "@/lib/db";

// Workspace home. The follow-up queue lands here in Milestone 4.
export default async function WorkspacePage({ params }: PageProps<"/[workspaceId]">) {
  const { workspaceId } = await params;
  const membership = await requireMembershipOr404(workspaceId);

  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: { name: true },
  });

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-8">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{workspace.name}</h1>
          <p className="text-sm text-zinc-500">You are {roleLabel(membership.role)}</p>
        </div>
        <div className="flex gap-2">
          <Link href={`/${workspaceId}/companies/new`} className="rounded border px-3 py-1">
            Add company
          </Link>
          <Link href={`/${workspaceId}/settings`} className="rounded border px-3 py-1">
            Settings
          </Link>
          <Link href="/workspaces" className="rounded border px-3 py-1">
            Switch workspace
          </Link>
          <SignOutButton />
        </div>
      </header>
    </main>
  );
}
