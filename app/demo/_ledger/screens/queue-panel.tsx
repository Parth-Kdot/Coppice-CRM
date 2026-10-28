"use client";

import Link from "next/link";
import { forwardRef, useCallback } from "react";
import { formatDay } from "@/demo/dates";
import { demoRoutes } from "@/demo/routes";
import { useCompany, useDemoActions } from "@/demo/store";
import { ClaimIcon, CloseIcon, ExternalIcon, LogIcon, ReleaseIcon, StageGlyph } from "../icons";
import { YearMargin } from "../marks";
import { useConfirm, useNotify } from "../providers";
import { OverdueMark } from "./overdue";
import { LogOutreachForm } from "./log-form";
import { ErrorLine, type useClaimAction } from "./shared";

// The facing page: what the queue shows beside the list when a row is selected. Company summary,
// who holds it, the contact, the last three log entries, Claim or Release, and Log outreach, which
// opens the fast log form right here. At 1280 px and wider it sits beside the list; below that it is
// a sheet from the right, and on a phone a sheet from the bottom. Escape closes it.

export const PANEL_ID = "queue-panel";

type ClaimAction = ReturnType<typeof useClaimAction>;

export const QueuePanel = forwardRef<
  HTMLElement,
  {
    ws: string;
    companyId: string;
    // True when it floats over the page as a sheet: it then behaves as a dialog and keeps Tab inside.
    sheet: boolean;
    logging: boolean;
    claimAction: ClaimAction;
    onLogging: (on: boolean) => void;
    onLogged: (companyId: string) => void;
    onClose: () => void;
  }
>(function QueuePanel({ ws, companyId, sheet, logging, claimAction, onLogging, onLogged, onClose }, ref) {
  const detail = useCompany(ws, companyId);
  const actions = useDemoActions();
  const confirm = useConfirm();
  const notify = useNotify();
  const titleId = `${PANEL_ID}-title`;

  const release = useCallback(async () => {
    if (!detail) return;
    const ok = await confirm({ message: `Release your claim on ${detail.company.name}?`, confirmLabel: "Release" });
    if (!ok) return;
    const result = actions.releaseClaim(ws, companyId);
    if (!result.ok) notify(result.error, "error");
    else {
      notify(`Released ${detail.company.name}.`);
      onLogging(false);
    }
  }, [actions, companyId, confirm, detail, notify, onLogging, ws]);

  if (!detail) return null;
  const company = detail.company;
  const claim = detail.claim;
  const contact = detail.contacts[0] ?? null;
  const entries = detail.outreach.slice(0, 3);
  const error = claimAction.errors[companyId];
  const until = claim.expiresAt ? formatDay(claim.expiresAt) : "";

  const body = (
    <>
      <div className="lg-insp-head">
        <p className="lg-sc lg-muted">Facing page</p>
        <button type="button" className="lg-btn lg-btn-sm" onClick={onClose} aria-label={`Close the side panel for ${company.name}`}>
          <CloseIcon size={16} />
          Close
        </button>
      </div>

      <h2 id={titleId} className="lg-insp-name">
        {company.name}
      </h2>
      <p className="lg-insp-meta">
        <span className="lg-qstage">
          <StageGlyph stage={company.stage} size={15} />
          {detail.stageLabel}
        </span>
        {company.industry && <span className="lg-muted">{company.industry}</span>}
      </p>
      {detail.followUpDays !== null && detail.nextFollowUp && (
        <p className="lg-insp-due">
          <OverdueMark days={detail.followUpDays} dueOn={detail.nextFollowUp} />
        </p>
      )}

      <section className="lg-insp-sec" aria-label="Claim">
        <p className="lg-insp-claim" data-state={claim.state}>
          {claim.state === "mine" && <>You hold this until {until}.</>}
          {claim.state === "theirs" && (
            <>
              Held by {claim.holderName} until {until}.
            </>
          )}
          {claim.state === "free" && <>Not claimed.</>}
          {claim.state === "expired" && <>{claim.holderName}&apos;s claim expired {until}. Anyone may take it.</>}
        </p>
        <div className="lg-insp-actions">
          {detail.canClaim && !detail.closed && (
            <button type="button" className="lg-btn lg-btn-primary" onClick={() => claimAction.claim(companyId, company.name)}>
              <ClaimIcon size={16} />
              Claim
            </button>
          )}
          {detail.canRelease && (
            <button type="button" className="lg-btn" onClick={release}>
              <ReleaseIcon size={16} />
              Release
            </button>
          )}
          {detail.canLogOutreach && (
            <button type="button" className="lg-btn" aria-expanded={logging} onClick={() => onLogging(!logging)}>
              <LogIcon size={16} />
              Log outreach
            </button>
          )}
          <Link href={demoRoutes.company(ws, companyId)} className="lg-btn lg-btn-quiet">
            Open full spread
            <ExternalIcon size={14} />
          </Link>
        </div>
        {claim.state === "theirs" && <p className="lg-hint">Ask them, or an owner, to hand it over.</p>}
        {!detail.canLogOutreach && claim.state !== "theirs" && !detail.closed && <p className="lg-hint">Claim it first, then log your outreach.</p>}
        <ErrorLine>{error}</ErrorLine>
      </section>

      {logging && detail.canLogOutreach && (
        <section className="lg-insp-sec" aria-label="Log outreach">
          <LogOutreachForm ws={ws} companyId={companyId} compact autoFocus onLogged={() => onLogged(companyId)} onCancel={() => onLogging(false)} />
        </section>
      )}

      <section className="lg-insp-sec" aria-labelledby={`${PANEL_ID}-contact`}>
        <h3 id={`${PANEL_ID}-contact`} className="lg-sc lg-muted">
          Contact
        </h3>
        {contact ? (
          <p className="lg-insp-contact">
            <strong>{contact.name}</strong>
            {contact.title && <span className="lg-muted">, {contact.title}</span>}
            {contact.email && <span className="lg-insp-email">{contact.email}</span>}
          </p>
        ) : (
          <p className="lg-muted">No contact yet.</p>
        )}
      </section>

      <section className="lg-insp-sec" aria-labelledby={`${PANEL_ID}-log`}>
        <h3 id={`${PANEL_ID}-log`} className="lg-sc lg-muted">
          Last three entries
        </h3>
        {entries.length === 0 ? (
          <p className="lg-muted">No outreach has been logged on this company yet.</p>
        ) : (
          <ol className="lg-insp-log">
            {entries.map((entry) => (
              <li key={entry.id}>
                <YearMargin iso={entry.sentAt} />
                <div>
                  <p className="lg-insp-entry">
                    <strong>{formatDay(entry.sentAt)}</strong>, {entry.channelLabel}, {entry.senderName}
                  </p>
                  {entry.note && <p className="lg-quote lg-insp-note">&ldquo;{entry.note}&rdquo;</p>}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );

  // Beside the list it is a plain complementary region. Below 1280 px it is a modal dialog, so the
  // browser keeps focus inside it, dims the page, and sends Escape to onCancel.
  if (!sheet) {
    return (
      <aside ref={ref} id={PANEL_ID} className="lg-insp" role="complementary" aria-labelledby={titleId} tabIndex={-1}>
        {body}
      </aside>
    );
  }
  return (
    <dialog
      ref={(el) => {
        if (el && !el.open) el.showModal();
        if (typeof ref === "function") ref(el);
        else if (ref) ref.current = el;
      }}
      id={PANEL_ID}
      className="lg-insp lg-insp-sheet"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {body}
    </dialog>
  );
});
