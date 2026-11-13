"use client";

import Link from "next/link";
import { useState } from "react";
import { logOutreach } from "@/app/(app)/[workspaceId]/companies/actions";
import { focusSoon } from "@/components/ledger/focus";
import { LogOutreachForm } from "@/components/ledger/log-form";
import { ErrorLine } from "@/components/ledger/shared";
import { STAGE_LABELS } from "@/lib/stages";
import type { CardRunner } from "./use-card-runner";
import type { ActionCard } from "./types";

// A confirm card says exactly what will happen, in a sentence, and has one button for it. An illegal
// card is shown with its reason and a button that can't be pressed. A log card opens the app's own
// short log form under it (nothing filled in): the form is the confirmation. Cards are list items
// with a data-card-key, which the card runner finds again to stamp and send them away.

export function ConfirmCard({
  card,
  runner,
  workspaceId,
  today,
  onCancel,
}: {
  card: ActionCard;
  runner: CardRunner;
  workspaceId: string;
  today: string;
  // A card opened from a row's chip can be closed again.
  onCancel?: () => void;
}) {
  const [logging, setLogging] = useState(false);
  const working = runner.busy(card.key);
  const error = runner.error(card.key);
  const kept = runner.kept(card.key);
  const panel = `askcard-log-${card.key.replace(/[^a-zA-Z0-9_-]/g, "")}`;

  return (
    <li className="lg-askcard" data-card-key={card.key} data-type={card.type} data-legal={card.legal || undefined} data-logging={logging || undefined}>
      <div className="lg-askcard-body">
        <p className="lg-askcard-text">
          {kept ? `${card.companyName} moved${card.stage ? ` to ${STAGE_LABELS[card.stage]}` : ""}.` : card.text}
          {!kept && (
            <>
              {" "}
              <Link href={card.href} className="lg-link">
                Open {card.companyName}
              </Link>
            </>
          )}
        </p>
        {!card.legal && card.reason && <p className="lg-askcard-why">{card.reason}</p>}
        {kept && (
          <p className="lg-askcard-why">
            Which email got the reply?{" "}
            <Link href={`${card.href}#outreach`} className="lg-link">
              Open {card.companyName} to mark it
            </Link>
            .
          </p>
        )}
      </div>
      <div className="lg-askcard-act">
        {!kept &&
          (card.opensForm ? (
            <button
              type="button"
              className="lg-btn lg-btn-sm lg-askcard-go"
              disabled={!card.legal}
              aria-expanded={logging}
              aria-controls={panel}
              onClick={() => {
                const open = !logging;
                setLogging(open);
                if (open) focusSoon(`#${panel} input[name="channel"]:checked`);
              }}
            >
              {logging ? "Hide the form" : card.label}
              <span className="lg-sr"> for {card.companyName}</span>
            </button>
          ) : (
            // aria-disabled, not disabled, while it works: a disabled button drops focus to the page.
            <button type="button" className="lg-btn lg-btn-sm lg-askcard-go" disabled={!card.legal} aria-disabled={working || undefined} onClick={() => !working && void runner.run(card)}>
              {working ? "Working..." : card.label}
              <span className="lg-sr"> for {card.companyName}</span>
            </button>
          ))}
        {onCancel && !kept && (
          <button type="button" className="lg-btn lg-btn-quiet lg-btn-sm" aria-disabled={working || undefined} onClick={() => !working && onCancel()}>
            Cancel
          </button>
        )}
      </div>
      {logging && card.opensForm && (
        <div id={panel} className="lg-askcard-log" role="group" aria-label={`Log outreach for ${card.companyName}`}>
          <LogOutreachForm workspaceId={workspaceId} companyId={card.companyId} action={logOutreach} today={today} compact onLogged={() => runner.logged(card)} />
        </div>
      )}
      {error && (
        <div className="lg-askcard-err">
          <ErrorLine>{error}</ErrorLine>
        </div>
      )}
    </li>
  );
}

// The cards an answer proposes, and "Apply all" when every one of them sets a follow-up date.
export function CardList({
  cards,
  applyAll,
  runner,
  workspaceId,
  today,
}: {
  cards: ActionCard[];
  applyAll: boolean;
  runner: CardRunner;
  workspaceId: string;
  today: string;
}) {
  if (cards.length === 0) return null;
  const todo = cards.filter((c) => c.legal);
  return (
    <section className="lg-askcards" aria-label="Changes to confirm">
      <div className="lg-askcards-head">
        <h3 className="lg-tag">{cards.length === 1 ? "Confirm this change" : `Confirm ${cards.length} changes`}</h3>
        {applyAll && (
          <button type="button" className="lg-btn lg-btn-sm" disabled={todo.length === 0} aria-disabled={runner.anyBusy || undefined} onClick={() => !runner.anyBusy && void runner.runAll(cards)}>
            {runner.anyBusy ? "Working..." : `Apply all ${todo.length}`}
          </button>
        )}
      </div>
      <ul className="lg-askcards-list">
        {cards.map((card) => (
          <ConfirmCard key={card.key} card={card} runner={runner} workspaceId={workspaceId} today={today} />
        ))}
      </ul>
    </section>
  );
}
