"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { demoRoutes } from "@/demo/routes";
import { useDemoActions, useDemoState, useWorkspaceList } from "@/demo/store";
import { boardYear, Ribbon } from "../marks";
import { LogoMark } from "../logo";
import { useNotify } from "../providers";
import { UserMenu } from "../user-menu";
import { Empty, ErrorLine } from "./shared";

// The workspace list: each workspace is a bound volume on a shelf. Click a spine to open its queue.
// Invitations wait beside the shelf with a Join button, and an owner-to-be can start a new volume.
export function WorkspacesScreen() {
  const router = useRouter();
  const actions = useDemoActions();
  const state = useDemoState();
  const list = useWorkspaceList();
  const notify = useNotify();
  const id = useId();
  const [name, setName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [joinErrors, setJoinErrors] = useState<Record<string, string>>({});
  const [working, setWorking] = useState<string | null>(null);

  const create = (e: FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    setWorking("create");
    const result = actions.createWorkspace(name);
    setWorking(null);
    if (!result.ok) {
      setCreateError(result.error);
      return;
    }
    notify("Workspace created. You are its Owner.");
    router.push(demoRoutes.queue(result.data.workspaceId));
  };

  const join = (inviteId: string) => {
    setWorking(inviteId);
    const result = actions.acceptInvitation(inviteId);
    setWorking(null);
    if (!result.ok) {
      setJoinErrors((cur) => ({ ...cur, [inviteId]: result.error }));
      return;
    }
    router.push(demoRoutes.queue(result.data.workspaceId));
  };

  const signOut = () => {
    actions.signOut();
    router.push(demoRoutes.signIn());
  };

  const volume = boardYear(state.now).long;

  return (
    <div className="lg-wslist">
      <a className="lg-skip" href="#main">
        Skip to the page
      </a>
      <header className="lg-wshead">
        <span className="lg-wslogo">
          <LogoMark size={40} />
          <span className="font-display text-[1.3rem] font-semibold tracking-[0.02em] text-ink">Coppice</span>
        </span>
        <div className="lg-actions">
          <p className="lg-wsme">{list.me.name}</p>
          <UserMenu ws={null} placement="header" />
        </div>
      </header>
      <div className="lg-double-rule lg-wsrule" />

      <main id="main" className="lg-wsmain lg-page-enter">
        <h1 className="lg-h1">Your workspaces</h1>

        {list.nothingHere ? (
          <Empty kind="nothing">
            <p className="lg-empty-title">
              No workspace is linked to <strong>{list.me.email}</strong>.
            </p>
            <p>Ask your sponsorship chair to invite this email, or sign in with a different Google account.</p>
            <p className="mt-3">
              <button type="button" className="lg-btn" onClick={signOut}>
                Use a different account
              </button>
            </p>
          </Empty>
        ) : (
          <>
            {list.workspaces.length > 0 && (
              <ul className="lg-shelf" aria-label="Your workspaces">
                {list.workspaces.map((card, i) => (
                  <li key={card.workspace.id} className="lg-volume" data-tone={i % 3}>
                    <Link href={demoRoutes.queue(card.workspace.id)} className="lg-vspine" aria-label={`${card.workspace.name}, ${card.roleLabel}`}>
                      <span className="lg-vband" aria-hidden="true" />
                      <span className="lg-vtitle">{card.workspace.name}</span>
                      <span className="lg-vband lg-vband-low" aria-hidden="true" />
                      <span className="lg-vyear lg-sc" aria-hidden="true">
                        {volume}
                      </span>
                    </Link>
                    <p className="lg-vcap">
                      <span className="lg-vname">{card.workspace.name}</span> ({card.roleLabel})
                    </p>
                    <p className="lg-vmeta">
                      {card.companyCount} companies, {card.dueCount} due
                      {card.myClaims > 0 ? `, you hold ${card.myClaims}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <div className="lg-shelfedge" aria-hidden="true" />

            {list.invitations.length > 0 && (
              <section className="lg-wssect" aria-labelledby={`${id}-inv`}>
                <h2 id={`${id}-inv`} className="lg-h2">
                  Invitations
                </h2>
                <ul className="lg-invites">
                  {list.invitations.map((inv) => (
                    <li key={inv.id}>
                      <Ribbon size="sm" className="lg-invribbon" />
                      <div>
                        <p>
                          <strong>{inv.workspaceName}</strong> as {inv.role === "owner" ? "Owner" : "Officer"}
                        </p>
                        <p className="lg-hint">Invited by {inv.invitedByName}.</p>
                        <ErrorLine>{joinErrors[inv.id]}</ErrorLine>
                      </div>
                      <button type="button" className="lg-btn lg-btn-primary" onClick={() => join(inv.id)} disabled={working === inv.id}>
                        {working === inv.id ? "Working..." : "Join"}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}

        {list.canCreate && (
          <section className="lg-wssect" aria-labelledby={`${id}-new`}>
            <h2 id={`${id}-new`} className="lg-h2">
              Create a workspace
            </h2>
            <form onSubmit={create} className="lg-createform">
              <div>
                <label className="lg-label" htmlFor={`${id}-name`}>
                  Workspace name
                </label>
                <input id={`${id}-name`} className="lg-input" placeholder="Org name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <button type="submit" className="lg-btn lg-btn-primary" disabled={working === "create"}>
                {working === "create" ? "Working..." : "Create"}
              </button>
            </form>
            <ErrorLine>{createError}</ErrorLine>
          </section>
        )}

      </main>
    </div>
  );
}
