"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useId, useState, type FormEvent } from "react";
import { formatDay } from "@/demo/dates";
import { demoRoutes } from "@/demo/routes";
import type { MemberView } from "@/demo/selectors";
import { useDemoActions, useSettings } from "@/demo/store";
import { CopyLinkIcon } from "../icons";
import { boardYear, TurnoverRule, YearMargin } from "../marks";
import { NotFoundPage } from "../not-found-page";
import { useConfirm, useNotify } from "../providers";
import { ErrorLine, PageHead } from "./shared";

// Settings: the members as a register (name, role, joined) with the board-year margin, invitations
// with a copyable link in a ruled box, the claim window, and the AI switch.

function MemberRow({ ws, name, m }: { ws: string; name: string; m: MemberView }) {
  const actions = useDemoActions();
  const confirm = useConfirm();
  const notify = useNotify();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const change = () => {
    const r = actions.changeMemberRole(ws, m.member.id, m.role === "owner" ? "member" : "owner");
    if (!r.ok) setError(r.error);
    else {
      setError(null);
      notify(`${m.person.name} is now ${m.role === "owner" ? "an Officer" : "an Owner"}.`);
    }
  };
  const remove = async () => {
    const ok = await confirm({ message: `Remove ${m.person.name} from ${name}?`, confirmLabel: "Remove" });
    if (!ok) return;
    const r = actions.removeMember(ws, m.member.id);
    if (!r.ok) setError(r.error);
    else notify(`${m.person.name} removed. ${r.data.released} claim${r.data.released === 1 ? "" : "s"} released.`);
  };
  const leave = async () => {
    const ok = await confirm({ message: `Leave ${name}?`, confirmLabel: "Leave workspace" });
    if (!ok) return;
    const r = actions.leaveWorkspace(ws);
    if (!r.ok) setError(r.error);
    else {
      notify(`You left ${name}.`);
      router.push(demoRoutes.workspaces());
    }
  };
  const hand = async () => {
    const ok = await confirm({ message: `Make ${m.person.name} Owner and make yourself Officer?`, confirmLabel: "Hand over" });
    if (!ok) return;
    const r = actions.transferOwnership(ws, m.member.id);
    if (!r.ok) setError(r.error);
    else notify(`${m.person.name} is now Owner.`);
  };

  return (
    <li className="lg-member">
      <YearMargin iso={m.member.joinedAt} />
      <div className="lg-memberbody">
        <p className="lg-membername">
          <strong>{m.person.name}</strong>
          {m.isMe ? <span className="lg-muted"> (you)</span> : null}
          {m.email ? <span className="lg-muted">, {m.email}</span> : null}
        </p>
        <p className="lg-membermeta">
          {m.roleLabel}, joined {formatDay(m.member.joinedAt)}
          {m.heldCompanies > 0 ? `, holds ${m.heldCompanies}` : ""}
        </p>
        <div className="lg-actions mt-1">
          {m.canChangeRole && (
            <button type="button" className="lg-btn lg-btn-sm" onClick={change}>
              {m.nextRoleLabel}
            </button>
          )}
          {m.canChangeRole && !m.isMe && m.role !== "owner" && (
            <button type="button" className="lg-btn lg-btn-sm" onClick={hand}>
              Hand over ownership
            </button>
          )}
          {m.canRemove && (
            <button type="button" className="lg-btn lg-btn-sm" onClick={remove}>
              Remove
            </button>
          )}
          {m.isMe && (
            <button type="button" className="lg-btn lg-btn-sm" onClick={leave}>
              Leave workspace
            </button>
          )}
        </div>
        <ErrorLine>{error}</ErrorLine>
      </div>
    </li>
  );
}

export function SettingsScreen({ ws }: { ws: string }) {
  const s = useSettings(ws);
  const actions = useDemoActions();
  const notify = useNotify();
  const id = useId();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "owner">("member");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteOk, setInviteOk] = useState(false);
  const [days, setDays] = useState<string | null>(null);
  const [daysMsg, setDaysMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [aiOn, setAiOn] = useState<boolean | null>(null);
  const [limit, setLimit] = useState<string | null>(null);
  const [aiMsg, setAiMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  if (!s) return <NotFoundPage inline />;
  const name = s.workspace.name;
  const windowValue = days ?? String(s.claimWindowDays);
  const enabled = aiOn ?? s.ai.enabled;
  const limitValue = limit ?? String(s.ai.limit);

  const invite = (e: FormEvent) => {
    e.preventDefault();
    const r = actions.inviteMember(ws, email, role);
    if (!r.ok) {
      setInviteError(r.error);
      setInviteOk(false);
      return;
    }
    setInviteError(null);
    setInviteOk(true);
    setEmail("");
  };

  // Members of the same board sit together; a double rule falls where one board's joiners end.
  const members = s.members;

  return (
    <div className="lg-settings">
      <PageHead title={`${name}: settings`}>
        <Link href={demoRoutes.queue(ws)} className="lg-btn">
          Back
        </Link>
      </PageHead>

      <section className="lg-leaf-page lg-sheet lg-ipage" aria-labelledby={`${id}-m`}>
        <h2 id={`${id}-m`} className="lg-bh">
          Members
        </h2>
        <ol className="lg-register">
          {members.map((m, i) => {
            const next = members[i + 1];
            const crosses = next && boardYear(next.member.joinedAt).start !== boardYear(m.member.joinedAt).start;
            return (
              <Fragment key={m.member.id}>
                <MemberRow ws={ws} name={name} m={m} />
                {crosses && (
                  <li>
                    <TurnoverRule endsYear={boardYear(m.member.joinedAt).long} />
                  </li>
                )}
              </Fragment>
            );
          })}
        </ol>
        {s.isOwner && <p className="lg-hint mt-3">To hand the workspace to someone else, make them Owner, then make yourself Officer or leave.</p>}
      </section>

      {s.isOwner && (
        <section className="lg-leaf-page lg-sheet lg-ipage" aria-labelledby={`${id}-i`}>
          <h2 id={`${id}-i`} className="lg-bh">
            Invitations
          </h2>
          <p className="lg-hint mb-3">No email is sent. Tell them to sign in with this Google email and click Join.</p>
          {s.invitations.length === 0 ? (
            <p className="lg-muted">No pending invitations.</p>
          ) : (
            <ul className="lg-invitelist">
              {s.invitations.map((inv) => (
                <li key={inv.id}>
                  <p>
                    <strong>{inv.email}</strong>: {inv.roleLabel}, pending
                  </p>
                  <p className="lg-hint">{inv.expiresLabel}. Invited by {inv.inviterName}.</p>
                  <div className="lg-linkbox">
                    <code>{inv.link}</code>
                    <button
                      type="button"
                      className="lg-btn lg-btn-sm"
                      onClick={async () => {
                        const r = await actions.copyInviteLink(ws, inv.id);
                        if (!r.ok) notify(r.error, "error");
                        else {
                          setCopiedId(inv.id);
                          notify(r.data.copied ? "Copied the invite link." : "Select the link and copy it. The browser blocked the clipboard.");
                        }
                      }}
                    >
                      <CopyLinkIcon size={16} />
                      {copiedId === inv.id ? "Copied" : "Copy link"}
                    </button>
                    <button
                      type="button"
                      className="lg-btn lg-btn-sm"
                      onClick={() => {
                        const r = actions.cancelInvitation(ws, inv.id);
                        if (!r.ok) notify(r.error, "error");
                        else notify("Invitation canceled.");
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={invite} className="lg-inviteform">
            <div>
              <label className="lg-label" htmlFor={`${id}-email`}>
                Email
              </label>
              <input id={`${id}-email`} className="lg-input" placeholder="name@purdue.edu" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <label className="lg-label" htmlFor={`${id}-role`}>
                Role
              </label>
              <select id={`${id}-role`} className="lg-select" value={role} onChange={(e) => setRole(e.target.value as "member" | "owner")}>
                <option value="member">Officer</option>
                <option value="owner">Owner</option>
              </select>
            </div>
            <button type="submit" className="lg-btn lg-btn-primary">
              Invite
            </button>
          </form>
          {inviteOk && !inviteError && (
            <p className="lg-ok mt-2" role="status">
              Invitation created.
            </p>
          )}
          <ErrorLine>{inviteError}</ErrorLine>
        </section>
      )}

      <section className="lg-leaf-page lg-sheet lg-ipage" aria-labelledby={`${id}-c`}>
        <h2 id={`${id}-c`} className="lg-bh">
          Claim window
        </h2>
        {s.isOwner ? (
          <>
            <form
              className="lg-inline"
              onSubmit={(e) => {
                e.preventDefault();
                const r = actions.updateClaimWindow(ws, Number(windowValue));
                setDaysMsg(r.ok ? { ok: true, text: "Saved." } : { ok: false, text: r.error });
              }}
            >
              <label className="lg-sr" htmlFor={`${id}-days`}>
                Claim window in days
              </label>
              <input id={`${id}-days`} className="lg-input lg-num lg-narrow" type="number" inputMode="numeric" min={1} max={60} value={windowValue} onChange={(e) => { setDays(e.target.value); setDaysMsg(null); }} />
              <span>days</span>
              <button type="submit" className="lg-btn">
                Save
              </button>
              {daysMsg?.ok && <span className="lg-ok" role="status">{daysMsg.text}</span>}
            </form>
            {daysMsg && !daysMsg.ok && <ErrorLine>{daysMsg.text}</ErrorLine>}
            <p className="lg-hint mt-2">Claims already taken keep the expiry they were given.</p>
          </>
        ) : (
          <p>Claims last {s.claimWindowDays} days.</p>
        )}
      </section>

      <section className="lg-leaf-page lg-sheet lg-ipage" aria-labelledby={`${id}-a`}>
        <h2 id={`${id}-a`} className="lg-bh">
          AI
        </h2>
        <p className="max-w-[66ch]">
          Drafts pitch emails from facts your workspace has verified. AI runs on Google&apos;s free Gemini tier, which may use what it&apos;s sent to improve Google&apos;s products, so names and email addresses are never sent to it.
        </p>
        <p className="lg-usage mt-2">
          {s.ai.used} AI call{s.ai.used === 1 ? "" : "s"} in the last {s.ai.windowDays} days, out of {s.ai.limit}.
        </p>
        {!s.ai.serverConfigured && <p className="lg-error mt-2">AI isn&apos;t set up on this server yet: it needs a GEMINI_API_KEY.</p>}
        <p className="mt-2">
          <Link href={demoRoutes.facts(ws)} className="lg-link">
            {s.isOwner ? "Manage the fact sheet" : "See the fact sheet"}
          </Link>
        </p>
        {s.isOwner ? (
          <>
            <form
              className="lg-aiform"
              onSubmit={(e) => {
                e.preventDefault();
                const r = actions.updateAiSettings(ws, { enabled, limit: Number(limitValue) });
                setAiMsg(r.ok ? { ok: true, text: "Saved." } : { ok: false, text: r.error });
              }}
            >
              <label className="lg-radio">
                <input type="checkbox" className="lg-check" checked={enabled} onChange={(e) => { setAiOn(e.target.checked); setAiMsg(null); }} />
                AI on for this workspace
              </label>
              <div className="lg-inline">
                <label className="lg-label !mb-0" htmlFor={`${id}-limit`}>
                  Limit
                </label>
                <input id={`${id}-limit`} className="lg-input lg-num lg-narrow" type="number" inputMode="numeric" min={0} max={5000} value={limitValue} onChange={(e) => { setLimit(e.target.value); setAiMsg(null); }} />
                <span>calls per {s.ai.windowDays} days</span>
                <button type="submit" className="lg-btn">
                  Save
                </button>
                {aiMsg?.ok && <span className="lg-ok" role="status">{aiMsg.text}</span>}
              </div>
            </form>
            {aiMsg && !aiMsg.ok && <ErrorLine>{aiMsg.text}</ErrorLine>}
          </>
        ) : (
          <p className="mt-2">{s.ai.enabled ? "AI is on for this workspace." : "AI is off for this workspace."}</p>
        )}
      </section>
    </div>
  );
}
