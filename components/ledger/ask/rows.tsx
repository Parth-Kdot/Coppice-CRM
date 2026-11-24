"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { logOutreach } from "@/app/(app)/[workspaceId]/companies/actions";
import { previewCard } from "@/app/(app)/[workspaceId]/ask/actions";
import { focusSoon } from "@/components/ledger/focus";
import { HourglassIcon } from "@/components/ledger/icons";
import { LogOutreachForm } from "@/components/ledger/log-form";
import { removeAway } from "@/components/ledger/motion-kit";
import { ErrorLine } from "@/components/ledger/shared";
import { ConfirmCard } from "./cards";
import type { ActionCard, CopilotAnswer } from "./types";
import { useCardRunner } from "./use-card-runner";

// The rows an answer found, one ruled line each, in the queue's own way: how late, the company and
// its stage, who holds it, and one "next best move" chip chosen by code from what is legal for this
// person right now. A chip makes no AI call. It asks the server for the confirm card of that one move
// and draws it under the row (or, for Log outreach, opens the app's short log form there). An illegal
// move is still drawn, with its reason, so the person sees why not.

type Row = CopilotAnswer["rows"][number];

function AskRow({ row, workspaceId, today, onChanged }: { row: Row; workspaceId: string; today: string; onChanged: () => void }) {
  const [card, setCard] = useState<ActionCard | null>(null);
  const [logging, setLogging] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const chip = useRef<HTMLButtonElement>(null);
  const logPanel = useRef<HTMLDivElement>(null);
  const logId = `askrow-log-${row.id}`;

  const closeCard = useCallback(() => {
    setCard(null);
    focusSoon(() => chip.current);
  }, []);
  const runner = useCardRunner({ workspaceId, onLeft: () => setCard(null), onChanged });

  const next = row.next;
  const choose = async () => {
    if (!next || asking) return;
    setProblem(null);
    if (next.type === "LOG" && next.legal) {
      const open = !logging;
      setLogging(open);
      setCard(null);
      if (open) focusSoon(`#${logId} input[name="channel"]:checked`);
      return;
    }
    if (card) {
      closeCard();
      return;
    }
    setAsking(true);
    const result = await previewCard({ workspaceId, companyId: row.id, type: next.type, stage: null, followUpOn: null });
    setAsking(false);
    if (!result.ok) {
      setProblem(result.error);
      return;
    }
    setLogging(false);
    // Its own key, so it can't clash with a card the answer itself proposes for the same company.
    setCard({ ...result.data, key: `row:${result.data.key}` });
  };

  return (
    <li className="lg-askrow lg-rule-row" data-open={card || logging ? true : undefined}>
      <div className="lg-askrow-grid">
        <span className="lg-askrow-due">
          {row.nextFollowUpAt !== null || row.overdue ? (
            <span className="lg-od" data-level={row.overdue ? "overdue" : "upcoming"}>
              <HourglassIcon sand={row.overdue ? "low" : "empty"} size={16} />
              <span>{row.dueLabel}</span>
            </span>
          ) : (
            <span className="lg-muted">{row.dueLabel}</span>
          )}
        </span>
        <span className="lg-askrow-name">
          <Link href={row.href} className="lg-askname" title={row.name}>
            {row.name}
          </Link>
          <span className="lg-askrow-meta">
            {row.stageLabel}
            {row.industry ? `, ${row.industry}` : ""}
          </span>
        </span>
        {/* A plan says why each company is listed ("Free and overdue"), which also says who holds it. */}
        <span className="lg-askrow-claim" data-state={row.claim.state} title={row.why ? row.claim.label : undefined}>
          {row.why ?? row.claim.label}
        </span>
        <span className="lg-askrow-act">
          {next && (
            <button
              ref={chip}
              type="button"
              className="lg-btn lg-btn-sm lg-asknext"
              data-legal={next.legal || undefined}
              aria-expanded={card !== null || logging}
              aria-controls={logging ? logId : undefined}
              aria-disabled={asking || undefined}
              title={next.legal ? undefined : (next.reason ?? undefined)}
              onClick={() => void choose()}
            >
              {next.label}
              <span className="lg-sr"> for {row.name}</span>
            </button>
          )}
        </span>
      </div>
      {problem && (
        <div className="lg-askrow-sub">
          <ErrorLine>{problem}</ErrorLine>
        </div>
      )}
      {card && (
        <ul className="lg-askrow-sub lg-askcards-list">
          <ConfirmCard card={card} runner={runner} workspaceId={workspaceId} today={today} onCancel={closeCard} />
        </ul>
      )}
      {logging && (
        <div ref={logPanel} id={logId} className="lg-askrow-sub lg-askrow-log" role="group" aria-label={`Log outreach for ${row.name}`}>
          <LogOutreachForm
            workspaceId={workspaceId}
            companyId={row.id}
            action={logOutreach}
            today={today}
            compact
            onLogged={async () => {
              await removeAway(logPanel.current, { focus: chip.current });
              setLogging(false);
              onChanged();
            }}
          />
          <button
            type="button"
            className="lg-btn lg-btn-quiet lg-btn-sm"
            onClick={() => {
              setLogging(false);
              focusSoon(() => chip.current);
            }}
          >
            Close
          </button>
        </div>
      )}
    </li>
  );
}

export function RowList({ rows, label, workspaceId, today, onChanged }: { rows: Row[]; label: string; workspaceId: string; today: string; onChanged: () => void }) {
  if (rows.length === 0) return null;
  return (
    <ul className="lg-askrows" aria-label={label}>
      {rows.map((row) => (
        <AskRow key={row.id} row={row} workspaceId={workspaceId} today={today} onChanged={onChanged} />
      ))}
    </ul>
  );
}
