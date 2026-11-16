"use client";

import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";
import { approveCard, approveRest, setCardHidden } from "@/app/(app)/[workspaceId]/capsule/actions";
import { ActionForm } from "@/components/action-form";
import type { CardView, OwnerView } from "@/lib/capsule";
import { Disclosure } from "../disclosure";
import { Tick } from "../marks";
import { completeStamp } from "../motion-kit";
import { ShowMore } from "../show-more";
import { BulletBody, bySection, FactsLine, StageChip } from "./card-parts";
import { groupByStage, plural } from "./format";
import { plain, toForm } from "./use-run";

// Step 3, review and redact. Cards are listed by stage. For each: Approve (stamped), hide one
// bullet, or hide the whole card. Hiding slides it away, writes a redaction the owner can undo, and
// a hidden bullet or card stays one click from coming back until the handoff is published. Bullet
// text can't be edited, which would break the quote that proves it, so each bullet shows its quote
// and a link to the company page it came from.

function Fields({ workspaceId, children }: { workspaceId: string; children: ReactNode }) {
  return (
    <>
      <input type="hidden" name="workspaceId" value={workspaceId} />
      {children}
    </>
  );
}

// The approval stamp: plays once when the card turns approved while the page is open, never on load.
function ApprovedMark({ approved }: { approved: boolean }) {
  const mark = useRef<HTMLSpanElement>(null);
  const was = useRef(approved);
  useEffect(() => {
    if (!was.current && approved) void completeStamp(mark.current, { mark: mark.current?.querySelector("svg") });
    was.current = approved;
  }, [approved]);
  if (!approved) return <span className="lg-badge lg-cap-pending">Not approved yet</span>;
  return (
    <span className="lg-cap-approved" ref={mark}>
      <Tick size={15} auto={false} className="lg-tick-draw" />
      Approved
    </span>
  );
}

const undoHide = (workspaceId: string, cardId: string, bulletIndex: number | null) => async () => {
  await setCardHidden(null, toForm({ workspaceId, cardId, bulletIndex: bulletIndex === null ? "" : String(bulletIndex), hidden: "0" }));
};

function ShowAgain({ workspaceId, cardId, bulletIndex, label }: { workspaceId: string; cardId: string; bulletIndex: number | null; label: string }) {
  return (
    <ActionForm action={setCardHidden} submitLabel="Show again" submitAriaLabel={label} small className="lg-cap-inline" focusAfter={`[data-card="${cardId}"] .lg-cap-name a`}>
      <Fields workspaceId={workspaceId}>
        <input type="hidden" name="cardId" value={cardId} />
        <input type="hidden" name="bulletIndex" value={bulletIndex === null ? "" : String(bulletIndex)} />
        <input type="hidden" name="hidden" value="0" />
      </Fields>
    </ActionForm>
  );
}

function ReviewCard({ workspaceId, card, locked }: { workspaceId: string; card: CardView; locked: boolean }) {
  // A hidden card keeps its place in the list as one line, with the way back.
  if (card.hidden) {
    return (
      <li className="lg-cap-card" data-hidden="" data-card={card.id}>
        <div className="lg-cap-cardhead">
          <h4 className="lg-cap-name">{card.companyName}</h4>
          <span className="lg-badge lg-cap-pending">Hidden from the capsule</span>
          {!locked && <ShowAgain workspaceId={workspaceId} cardId={card.id} bulletIndex={null} label={`Show ${card.companyName} again`} />}
        </div>
      </li>
    );
  }
  const visible = card.bullets.filter((b) => !b.hidden);
  const hiddenBullets = card.bullets.filter((b) => b.hidden);
  return (
    <li className="lg-cap-card" data-approved={card.approved || undefined} data-card={card.id}>
      <div className="lg-cap-cardhead">
        <h4 className="lg-cap-name">
          <Link className="lg-link" href={`/${workspaceId}/companies/${card.companyId}`}>
            {card.companyName}
          </Link>
        </h4>
        <StageChip stage={card.facts.stage} />
        <ApprovedMark approved={card.approved} />
      </div>
      <FactsLine facts={card.facts} />
      {visible.length === 0 ? (
        <p className="lg-hint lg-cap-factsonly">{card.bullets.length === 0 ? "Facts only. No notes were read for this card." : "Every bullet on this card is hidden."}</p>
      ) : (
        <ul className="lg-cap-bullets">
          {bySection(visible).map((b) => (
            <li key={b.index} className="lg-cap-bullet">
              <BulletBody bullet={b} workspaceId={workspaceId} companyId={card.companyId} />
              {!locked && (
                <ActionForm
                  action={setCardHidden}
                  submitLabel="Hide"
                  submitAriaLabel={`Hide this bullet from ${card.companyName}`}
                  small
                  submitClassName="lg-btn-quiet"
                  leaveRow
                  successMessage="Bullet hidden."
                  successUndo={undoHide(workspaceId, card.id, b.index)}
                  className="lg-cap-inline lg-cap-hide"
                >
                  <Fields workspaceId={workspaceId}>
                    <input type="hidden" name="cardId" value={card.id} />
                    <input type="hidden" name="bulletIndex" value={b.index} />
                    <input type="hidden" name="hidden" value="1" />
                  </Fields>
                </ActionForm>
              )}
            </li>
          ))}
        </ul>
      )}
      {hiddenBullets.length > 0 && (
        <Disclosure variant="inline" summary={`Hidden bullets (${hiddenBullets.length})`} className="lg-cap-hiddenlist">
          <ul className="lg-cap-bullets">
            {hiddenBullets.map((b) => (
              <li key={b.index} className="lg-cap-bullet" data-hidden="">
                <p className="lg-cap-btext">{b.text}</p>
                {!locked && <ShowAgain workspaceId={workspaceId} cardId={card.id} bulletIndex={b.index} label={`Show this bullet again on ${card.companyName}`} />}
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
      {!locked && (
        <div className="lg-cap-cardactions">
          {!card.approved && (
            <ActionForm action={approveCard} submitLabel="Approve" submitAriaLabel={`Approve the card for ${card.companyName}`} small primary successMessage={`Approved ${card.companyName}.`} className="lg-cap-inline" focusAfter={`[data-card="${card.id}"] .lg-cap-cardactions button`}>
              <Fields workspaceId={workspaceId}>
                <input type="hidden" name="cardId" value={card.id} />
              </Fields>
            </ActionForm>
          )}
          <ActionForm
            action={setCardHidden}
            submitLabel="Hide card"
            submitAriaLabel={`Hide the card for ${card.companyName}`}
            small
            submitClassName="lg-btn-quiet"
            leaveRow
            successMessage={`Hid the card for ${card.companyName}.`}
            successUndo={undoHide(workspaceId, card.id, null)}
            className="lg-cap-inline"
          >
            <Fields workspaceId={workspaceId}>
              <input type="hidden" name="cardId" value={card.id} />
              <input type="hidden" name="bulletIndex" value="" />
              <input type="hidden" name="hidden" value="1" />
            </Fields>
          </ActionForm>
        </div>
      )}
    </li>
  );
}

export function StepReview({ workspaceId, view, locked }: { workspaceId: string; view: OwnerView | null; locked: boolean }) {
  if (!view || view.cards.length === 0) {
    return (
      <div>
        <h3 className="lg-cap-steph">Review</h3>
        <p className="lg-muted">There are no cards to review yet. Make them on the previous step.</p>
      </div>
    );
  }
  const groups = groupByStage(view.cards.map((c) => ({ ...c, stage: c.facts.stage })));
  const { counts } = view;
  return (
    <div>
      <h3 className="lg-cap-steph">Review</h3>
      <p className="lg-muted lg-cap-stepsub">
        Approve the cards that are right, hide a bullet or a card that should not be handed on. Officers see only approved cards and bullets you left visible. You can undo a hide until you publish.
      </p>
      <div className="lg-cap-actionrow">
        {!locked && counts.pending > 0 ? (
          <ActionForm action={plain(approveRest)} submitLabel={`Approve the rest (${counts.pending})`} primary successMessage="Approved the rest." className="lg-cap-inline" focusAfter="#cap-next">
            <Fields workspaceId={workspaceId}>
              <input type="hidden" name="reportId" value={view.report.id} />
            </Fields>
          </ActionForm>
        ) : null}
        <p className="lg-hint" role="status">
          {plural(counts.cards, "card", "cards")}: {counts.approved} approved, {counts.hidden} hidden, {counts.pending} still to review.
        </p>
      </div>
      {groups.map((group) => (
        <section key={group.stage} className="lg-cap-group" aria-labelledby={`rev-${group.stage}`}>
          <h4 id={`rev-${group.stage}`} className="lg-cap-grouph">
            {group.label}
            <span className="lg-panel-count lg-num"> {group.items.length}</span>
          </h4>
          <ShowMore as="ul" initial={4} label={`${group.label.toLowerCase()} cards`} listClassName="lg-cap-cards">
            {group.items.map((card) => (
              <ReviewCard key={card.hidden ? `${card.id}:hidden` : card.id} workspaceId={workspaceId} card={card} locked={locked} />
            ))}
          </ShowMore>
        </section>
      ))}
    </div>
  );
}
