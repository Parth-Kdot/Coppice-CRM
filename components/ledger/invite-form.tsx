"use client";

import { useActionState, useEffect, useId, useMemo, useRef, useState } from "react";
import { ChipGroup } from "@/components/ledger/chips";
import { focusSoon } from "@/components/ledger/focus";
import { OverflowMenu, type OverflowItem } from "@/components/ledger/overflow-menu";
import { useNotify } from "@/components/ledger/providers";
import { ErrorLine } from "@/components/ledger/shared";
import { ShowMore } from "@/components/ledger/show-more";
import type { ActionResult } from "@/lib/validation";
import "./company.css";
import "./pages.css";
import "./settings.css";

// The client parts of Settings > Members: the member list with one ⋯ menu per row, the invitation
// form with "Copy invite message", the Danger zone's delete form, and the helper that opens the
// section a link points at (#templates, #research-sources).

type Action<T = undefined> = (prev: ActionResult<T> | null, form: FormData) => Promise<ActionResult<T>>;

// ----- Invite -----

export type InviteResult = { email: string; renewed: boolean; until: string };

// No email is sent, so after an invite the owner gets the words to pass on.
export function inviteMessage(origin: string, email: string, workspaceName: string): string {
  return `${origin}/signin\nSign in with ${email} and click Join on ${workspaceName}.`;
}

export function InviteForm({ workspaceId, workspaceName, action }: { workspaceId: string; workspaceName: string; action: Action<InviteResult> }) {
  const id = useId();
  const notify = useNotify();
  const [role, setRole] = useState<"member" | "owner">("member");
  const [copied, setCopied] = useState("");
  const [state, formAction, pending] = useActionState(async (prev: ActionResult<InviteResult> | null, data: FormData) => {
    const result = await action(prev, data);
    if (result.ok) {
      notify(result.data.renewed ? `Already invited; renewed until ${result.data.until}.` : "Invitation created.");
      setCopied("");
    }
    return result;
  }, null);
  const last = state?.ok ? state.data : null;

  const copy = async () => {
    if (!last) return;
    try {
      await navigator.clipboard.writeText(inviteMessage(window.location.origin, last.email, workspaceName));
      setCopied("Copied. Paste it into a message to them.");
    } catch {
      setCopied("Could not copy. Tell them to sign in with this email and click Join.");
    }
  };

  return (
    <div className="lg-invite">
      <form
        action={formAction}
        className="lg-inviteform"
        data-tour="invite"
        onSubmit={(e) => {
          // A second press while the first is on its way does nothing (the button stays focusable).
          if (pending) e.preventDefault();
        }}
      >
        <input type="hidden" name="workspaceId" value={workspaceId} />
        <div>
          <label className="lg-label" htmlFor={`${id}-email`}>
            Invite by Google email
          </label>
          <input
            id={`${id}-email`}
            name="email"
            type="email"
            required
            maxLength={254}
            placeholder="name@purdue.edu"
            autoComplete="off"
            className="lg-input"
          />
        </div>
        <ChipGroup
          legend="Role"
          name="role"
          value={role}
          onChange={setRole}
          options={[
            { value: "member", label: "Officer" },
            { value: "owner", label: "Owner" },
          ]}
        />
        <button type="submit" className="lg-btn lg-btn-primary" aria-disabled={pending || undefined}>
          {pending ? "Working..." : "Invite"}
        </button>
        {state && !state.ok && (
          <div className="lg-inviteform-error">
            <ErrorLine>{state.error}</ErrorLine>
          </div>
        )}
      </form>
      {last && (
        <div className="lg-invitecopy">
          <p className="lg-wrap-any">
            {last.renewed ? "Renewed" : "Invited"} <strong>{last.email}</strong> until {last.until}. No email is sent.
          </p>
          <button type="button" className="lg-btn lg-btn-sm" onClick={copy} data-tour="invite-copy">
            Copy invite message
          </button>
          <p className="lg-hint" role="status">
            {copied}
          </p>
        </div>
      )}
    </div>
  );
}

// ----- Members -----

export type MemberRow = {
  id: string;
  name: string;
  // Only loaded for owners.
  email: string | null;
  role: "owner" | "member";
  joined: string;
  isMe: boolean;
};

const roleName = (role: "owner" | "member") => (role === "owner" ? "Owner" : "Officer");

// Past this many members the list shows the first ten, "Show all", and a filter box.
export const MEMBERS_SHOWN = 10;

export function MemberList({
  members,
  isOwner,
  ownerCount,
  onlyOwnerMessage,
  workspaceName,
  workspaceId,
  actions,
}: {
  members: MemberRow[];
  isOwner: boolean;
  ownerCount: number;
  onlyOwnerMessage: string;
  workspaceName: string;
  workspaceId: string;
  actions: { changeRole: Action; remove: Action; leave: Action };
}) {
  const filterId = useId();
  const [filter, setFilter] = useState("");
  const query = filter.trim().toLowerCase();
  const matches = useMemo(
    () => (query ? members.filter((m) => m.name.toLowerCase().includes(query) || (m.email ?? "").toLowerCase().includes(query)) : members),
    [members, query],
  );
  // leaveWorkspace redirects on success, so its call can come back empty; that is a success.
  const leave = actions.leave;
  const leaveAction = useMemo<Action>(() => async (prev, form) => (await leave(prev, form)) ?? { ok: true, data: undefined }, [leave]);
  const onlyOwner = ownerCount <= 1;

  const itemsFor = (m: MemberRow): OverflowItem[] => {
    const fields = { workspaceId, memberId: m.id };
    const first = m.name.split(/\s+/)[0] || m.name;
    if (m.isMe) {
      const items: OverflowItem[] = [];
      if (isOwner) {
        items.push({
          key: "officer",
          label: "Make me an Officer",
          hint: onlyOwner ? undefined : "You keep your claims; another owner stays in charge.",
          disabled: onlyOwner,
          disabledReason: onlyOwnerMessage,
          action: actions.changeRole,
          fields: { ...fields, role: "member" },
          confirmMessage: "Make yourself an Officer? You can't invite people or change settings afterwards.",
          successMessage: "You are now an Officer.",
        });
      }
      items.push({
        key: "leave",
        label: "Leave workspace",
        danger: true,
        disabled: isOwner && onlyOwner,
        disabledReason: onlyOwnerMessage,
        action: leaveAction,
        fields: { workspaceId },
        confirmMessage: `Leave ${workspaceName}? Your claims are released for others to take.`,
      });
      return items;
    }
    if (!isOwner) return [];
    return [
      m.role === "owner"
        ? {
            key: "officer",
            label: "Make Officer",
            action: actions.changeRole,
            fields: { ...fields, role: "member" },
            successMessage: `${m.name} is now an Officer.`,
          }
        : {
            key: "owner",
            label: "Make Owner",
            action: actions.changeRole,
            fields: { ...fields, role: "owner" },
            confirmMessage: `Make ${first} an Owner? Owners can invite and remove people and change AI settings.`,
            successMessage: `${m.name} is now an Owner.`,
          },
      {
        key: "remove",
        label: "Remove",
        danger: true,
        action: actions.remove,
        fields,
        confirmMessage: `Remove ${m.name} from ${workspaceName}? Their claims are released.`,
        successMessage: `${m.name} removed.`,
        focusAfter: "#set-members",
        leaveRow: true,
      },
    ];
  };

  const row = (m: MemberRow) => {
    const items = itemsFor(m);
    return (
      <li key={m.id} className="lg-mrow" data-me={m.isMe || undefined}>
        <p className="lg-mrow-name">
          <span className="lg-trunc" title={m.name}>
            {m.name}
          </span>
          {m.isMe && <span className="lg-muted"> (you)</span>}
        </p>
        <p className="lg-mrow-meta">
          <span className="lg-badge" data-role={m.role}>
            {roleName(m.role)}
          </span>
          {isOwner && <span className="lg-mrow-joined">joined {m.joined}</span>}
          {m.email && (
            <span className="lg-trunc lg-mrow-email" title={m.email}>
              {m.email}
            </span>
          )}
        </p>
        <div className="lg-mrow-act">
          {items.length > 0 && <OverflowMenu label={m.isMe ? "More actions for you" : `More actions for ${m.name}`} items={items} />}
        </div>
      </li>
    );
  };

  const many = members.length > MEMBERS_SHOWN;
  return (
    <div className="lg-members">
      {many && (
        <div className="lg-mfilter">
          <label className="lg-sr" htmlFor={filterId}>
            Filter members
          </label>
          <input
            id={filterId}
            type="search"
            className="lg-input"
            placeholder={isOwner ? "Filter by name or email" : "Filter by name"}
            autoComplete="off"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <p className="lg-sr" role="status">
            {query ? `${matches.length} of ${members.length} members match.` : ""}
          </p>
        </div>
      )}
      {query ? (
        matches.length === 0 ? (
          <p className="lg-muted lg-mempty">No member matches &ldquo;{filter.trim()}&rdquo;.</p>
        ) : (
          <ol className="lg-mlist">{matches.map(row)}</ol>
        )
      ) : (
        <ShowMore initial={MEMBERS_SHOWN} label="members" as="ol" listClassName="lg-mlist">
          {members.map(row)}
        </ShowMore>
      )}
    </div>
  );
}

// ----- Danger zone -----

// Delete is offered only once the typed name matches, so the refusal is said before the click.
export function DeleteWorkspaceForm({ workspaceId, workspaceName, action }: { workspaceId: string; workspaceName: string; action: Action }) {
  const id = useId();
  const [typed, setTyped] = useState("");
  const [state, formAction, pending] = useActionState(async (prev: ActionResult | null, data: FormData) => (await action(prev, data)) ?? null, null);
  const matches = typed.trim() === workspaceName.trim();
  return (
    <form
      action={formAction}
      className="lg-deleteform"
      onSubmit={(e) => {
        if (!matches || pending) e.preventDefault();
      }}
    >
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <p>Deleting removes every company, contact, outreach entry and template in it, for everyone. It can&apos;t be undone.</p>
      <div>
        <label className="lg-label" htmlFor={`${id}-name`}>
          Type <span className="lg-wrap-any">&ldquo;{workspaceName}&rdquo;</span> to confirm
        </label>
        <input
          id={`${id}-name`}
          name="confirmName"
          className="lg-input"
          autoComplete="off"
          spellCheck={false}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          aria-describedby={`${id}-state`}
        />
      </div>
      <button type="submit" className="lg-btn lg-btn-danger" aria-disabled={!matches || pending || undefined} aria-describedby={`${id}-state`}>
        {pending ? "Deleting..." : "Delete workspace"}
      </button>
      <p id={`${id}-state`} className="lg-hint">
        {matches ? "" : "The button works once the name matches."}
      </p>
      {state && !state.ok && <ErrorLine>{state.error}</ErrorLine>}
    </form>
  );
}

// ----- Opening the section a link points at -----

// Settings' sections start closed. A link to /settings#templates (from Template stats) or
// #research-sources (from a brief) should land on that section open, so this opens every <details>
// around the target, on load and whenever the hash changes, then brings the target into view.
export function OpenFromHash() {
  const done = useRef("");
  useEffect(() => {
    const open = () => {
      const hash = decodeURIComponent(window.location.hash.slice(1));
      if (!hash || hash === done.current) return;
      const target = document.getElementById(hash);
      if (!target) return;
      done.current = hash;
      for (let el: Element | null = target; el; el = el.parentElement) {
        if (el instanceof HTMLDetailsElement) el.open = true;
      }
      // No smooth scroll: it would ignore reduced motion, and focusing scrolls the target into view.
      const summary = target instanceof HTMLDetailsElement ? target.querySelector("summary") : null;
      focusSoon(summary ?? target);
    };
    open();
    const onHash = () => {
      done.current = "";
      open();
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return null;
}
