"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ActionForm } from "@/components/ledger/action-form";
import { boardYear } from "@/components/ledger/board-year";
import { LogoMark } from "@/components/ledger/logo";
import { Empty } from "@/components/ledger/shared";
import { useDemoActions, useDemoState, useWorkspaceList } from "@/demo/store";
import { useFormActions } from "../form-actions";
import "@/components/ledger/ledger.css";
import "@/components/ledger/auth.css";

// The workspace list: each workspace is a bound volume on a shelf, as in the real app.
export function WorkspacesPage() {
  const list = useWorkspaceList();
  const state = useDemoState();
  const actions = useDemoActions();
  const router = useRouter();
  const a = useFormActions();
  const { me, workspaces, invitations, canCreate, nothingHere } = list;
  const volume = boardYear(new Date(state.now)).long;
  const signOut = () => {
    actions.signOut();
    router.push("/demo/signin");
  };

  return (
    <div className="lg-wslist">
      <a className="lg-skip" href="#main">
        Skip to the page
      </a>
      <header className="lg-wshead">
        <Link href="/" className="lg-wslogo" aria-label="Coppice, home">
          <LogoMark size={40} />
          <span className="font-display text-[length:var(--fs-4)] font-medium tracking-[0.01em] text-ink">Coppice</span>
        </Link>
        <div className="lg-wsme">
          <p className="lg-wsme-name">{me.name}</p>
          <button type="button" className="lg-btn" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>
      <div className="lg-double-rule" />

      <main id="main" tabIndex={-1} className="lg-wsmain lg-page-enter">
        <h1 className="lg-h1">Your workspaces</h1>

        {workspaces.length > 0 && (
          <>
            <p className="lg-sub">Open a volume to see its queue.</p>
            <ul className="lg-shelf" aria-label="Your workspaces">
              {workspaces.map(({ workspace, roleLabel }, i) => (
                <li key={workspace.id} className="lg-volume" data-tone={i % 3}>
                  <Link href={`/demo/w/${workspace.id}`} className="lg-vspine" aria-label={`${workspace.name}, ${roleLabel}`}>
                    <span className="lg-vband" aria-hidden="true" />
                    <span className="lg-vtitle">{workspace.name}</span>
                    <span className="lg-vband" aria-hidden="true" />
                    <span className="lg-vyear" aria-hidden="true">
                      {volume}
                    </span>
                  </Link>
                  <p className="lg-vcap">
                    <span className="lg-vname">{workspace.name}</span> ({roleLabel})
                  </p>
                </li>
              ))}
            </ul>
            <div className="lg-shelfedge" aria-hidden="true" />
          </>
        )}

        {invitations.length > 0 && (
          <section className="lg-wssect" aria-labelledby="ws-invites">
            <h2 id="ws-invites" className="lg-h2">
              Invitations
            </h2>
            <ul className="lg-invites">
              {invitations.map((invite) => (
                <li key={invite.id}>
                  <p>
                    <strong>{invite.workspaceName}</strong> as {invite.role === "owner" ? "Owner" : "Officer"}
                  </p>
                  <ActionForm action={a.acceptInvitation} submitLabel="Join" primary>
                    <input type="hidden" name="invitationId" value={invite.id} />
                  </ActionForm>
                </li>
              ))}
            </ul>
          </section>
        )}

        {nothingHere && !canCreate && (
          <Empty kind="no-workspace">
            <p className="font-display text-[length:var(--fs-4)] font-medium leading-snug">
              No workspace is linked to <strong>{me.email}</strong>.
            </p>
            <p className="lg-sub mt-1">Ask your sponsorship chair to invite this email, or sign in with a different Google account.</p>
          </Empty>
        )}

        {canCreate && (
          <section className="lg-wssect" aria-labelledby="ws-create">
            <h2 id="ws-create" className="lg-h2">
              Create a workspace
            </h2>
            <p className="lg-sub mt-1">You become its Owner. Invite your officers from Settings afterwards.</p>
            <div className="lg-createform">
              <ActionForm action={a.createWorkspace} submitLabel="Create" primary className="flex flex-wrap items-end gap-2">
                <label className="block flex-1">
                  <span className="lg-label">Workspace name</span>
                  <input name="name" required placeholder="Your org's name" className="lg-input" autoComplete="off" />
                </label>
              </ActionForm>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
