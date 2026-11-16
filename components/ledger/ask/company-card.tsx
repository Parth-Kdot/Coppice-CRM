"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { previewCard } from "@/app/(app)/[workspaceId]/ask/actions";
import { logOutreach } from "@/app/(app)/[workspaceId]/companies/actions";
import { focusSoon } from "@/components/ledger/focus";
import { BoardIcon, HourglassIcon } from "@/components/ledger/icons";
import { LogOutreachForm } from "@/components/ledger/log-form";
import { removeAway } from "@/components/ledger/motion-kit";
import { OverflowMenu } from "@/components/ledger/overflow-menu";
import { ErrorLine } from "@/components/ledger/shared";
import { addDays, day, formatYmd } from "@/lib/dates";
import type { CompanyCard as CompanyCardData } from "@/lib/copilot";
import type { Stage } from "@/generated/prisma/enums";
import { ConfirmCard } from "./cards";
import type { ActionCard } from "./types";
import { useCardRunner } from "./use-card-runner";

// One company, as the answer to "what's our history with Acme?": its stage, who holds it, the dates,
// its contacts and its last three outreach entries as the company page lists them, then the moves
// that are legal for this person right now. A move makes no change: it draws the confirm card for it
// under the buttons. What can't be done right now is said once, with the reason in the app's words.

const FOLLOW_UP_DAYS = [3, 7, 14, 30] as const;
const MOVE_NAMES = { CLAIM: "Claim", RELEASE: "Release", LOG: "Log outreach", MOVE_STAGE: "Move stage", SET_FOLLOW_UP: "Set follow-up" } as const;

export function CompanyCard({ company, workspaceId, today, onChanged }: { company: CompanyCardData; workspaceId: string; today: string; onChanged: () => void }) {
  const [card, setCard] = useState<ActionCard | null>(null);
  const [logging, setLogging] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  const logPanel = useRef<HTMLDivElement>(null);
  const logId = `askco-log-${company.id}`;
  const { moves } = company;

  const closeCard = useCallback(() => {
    setCard(null);
    focusSoon(() => bar.current?.querySelector<HTMLElement>("button") ?? null);
  }, []);
  const runner = useCardRunner({ workspaceId, onLeft: () => setCard(null), onChanged });

  const preview = async (type: ActionCard["type"], stage: Stage | null = null, followUpOn: string | null = null) => {
    setProblem(null);
    if (type === "LOG") {
      setLogging((open) => !open);
      setCard(null);
      focusSoon(`#${logId} input[name="channel"]:checked`);
      return;
    }
    const result = await previewCard({ workspaceId, companyId: company.id, type, stage, followUpOn });
    if (!result.ok) {
      setProblem(result.error);
      return;
    }
    setLogging(false);
    setCard({ ...result.data, key: `co:${result.data.key}` });
  };

  const buttons: { type: ActionCard["type"]; label: string }[] = [];
  if (moves.CLAIM.legal) buttons.push({ type: "CLAIM", label: company.claim.state === "mine" ? "Renew claim" : "Claim" });
  if (moves.RELEASE.legal) buttons.push({ type: "RELEASE", label: moves.RELEASE.force ? "Force release" : "Release" });
  if (moves.LOG.legal) buttons.push({ type: "LOG", label: "Log outreach" });

  // The reasons moves are not available, each said once ("Claim, Log outreach: This company is archived.").
  const blocked = new Map<string, string[]>();
  for (const type of Object.keys(moves) as (keyof typeof moves)[]) {
    const move = moves[type];
    if (move.legal || !move.reason) continue;
    blocked.set(move.reason, [...(blocked.get(move.reason) ?? []), MOVE_NAMES[type]]);
  }

  return (
    <article className="lg-askco" aria-label={company.name}>
      <header className="lg-askco-head">
        <h3 className="lg-askco-name">
          <Link href={company.href}>
            {company.name}
          </Link>
        </h3>
        <p className="lg-askco-sub">
          {[company.stageLabel, company.industry, company.website, company.archived ? "Archived" : null].filter(Boolean).join(", ")}
        </p>
      </header>

      <dl className="lg-askco-facts">
        <div>
          <dt>Claim</dt>
          <dd data-state={company.claim.state}>{company.claim.label}</dd>
        </div>
        <div>
          <dt>Last contacted</dt>
          <dd>{company.lastContactedAt ? day(new Date(company.lastContactedAt)) : "Never"}</dd>
        </div>
        <div>
          <dt>Next follow-up</dt>
          <dd>{company.dueLabel}</dd>
        </div>
      </dl>

      {company.contacts.length > 0 && (
        <section className="lg-askco-sect" aria-label="Contacts">
          <h4 className="lg-tag">Contacts</h4>
          <ul className="lg-askco-contacts">
            {company.contacts.map((c) => (
              <li key={c.id}>
                <span className="lg-askco-cname">{c.name}</span>
                {c.title && <span className="lg-muted">, {c.title}</span>}
                {c.email && <span className="lg-muted lg-wrap-any"> ({c.email})</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="lg-askco-sect" aria-label="Recent outreach">
        <h4 className="lg-tag">
          Recent outreach
          {company.outreachTotal > company.outreach.length ? ` (last ${company.outreach.length} of ${company.outreachTotal})` : ""}
        </h4>
        {company.outreach.length === 0 ? (
          <p className="lg-muted">Nothing has been logged for this company yet.</p>
        ) : (
          <ol className="lg-askco-log">
            {company.outreach.map((o) => (
              <li key={o.id}>
                <span className="lg-askco-when">{o.sentLabel}</span>
                <span className="lg-askco-what">
                  {o.channelLabel} by {o.by}
                  {o.viaAssistant ? ", via assistant" : ""}
                  {o.templateName ? `, template ${o.templateName}` : ""}
                  {o.aiDrafted ? ", AI draft" : ""}
                  {o.gotReply ? ", got the reply" : ""}
                </span>
                {o.note && <span className="lg-quote lg-askco-note">&ldquo;{o.note}&rdquo;</span>}
              </li>
            ))}
          </ol>
        )}
      </section>

      {!company.archived && (
        <div ref={bar} className="lg-askco-moves" role="group" aria-label={`Moves for ${company.name}`}>
          {buttons.map((b) => (
            <button key={b.type} type="button" className="lg-btn lg-btn-sm" aria-expanded={b.type === "LOG" ? logging : undefined} aria-controls={b.type === "LOG" ? logId : undefined} onClick={() => void preview(b.type)}>
              {b.label}
              <span className="lg-sr"> for {company.name}</span>
            </button>
          ))}
          {moves.MOVE_STAGE.legal && company.stages.length > 0 && (
            <OverflowMenu
              label={`Move stage for ${company.name}`}
              buttonText="Move stage"
              icon={<BoardIcon size={16} />}
              caret
              align="left"
              items={company.stages.map((s) => ({
                key: s.stage,
                label: s.label,
                hint: s.confirm === "closes" ? "Closes the pitch, asks first" : s.confirm === "reopens" ? "Reopens it, asks first" : s.confirm === "back" ? "Moves it back, asks first" : undefined,
                onSelect: () => void preview("MOVE_STAGE", s.stage),
              }))}
            />
          )}
          {moves.SET_FOLLOW_UP.legal && (
            <OverflowMenu
              label={`Set the follow-up for ${company.name}`}
              buttonText="Set follow-up"
              icon={<HourglassIcon size={16} />}
              caret
              align="left"
              items={FOLLOW_UP_DAYS.map((n) => {
                const on = addDays(today, n);
                return { key: `d${n}`, label: `In ${n} days`, hint: formatYmd(on), onSelect: () => void preview("SET_FOLLOW_UP", null, on) };
              })}
            />
          )}
        </div>
      )}
      {[...blocked].map(([reason, names]) => (
        <p key={reason} className="lg-askco-blocked">
          {names.join(", ")}: {reason}
        </p>
      ))}
      {problem && <ErrorLine>{problem}</ErrorLine>}
      {card && (
        <ul className="lg-askcards-list lg-askco-card">
          <ConfirmCard card={card} runner={runner} workspaceId={workspaceId} today={today} onCancel={closeCard} />
        </ul>
      )}
      {logging && (
        <div ref={logPanel} id={logId} className="lg-askco-card lg-askrow-log" role="group" aria-label={`Log outreach for ${company.name}`}>
          <LogOutreachForm
            workspaceId={workspaceId}
            companyId={company.id}
            action={logOutreach}
            today={today}
            compact
            onLogged={async () => {
              await removeAway(logPanel.current, { focus: bar.current?.querySelector<HTMLElement>("button") });
              setLogging(false);
              onChanged();
            }}
          />
          <button type="button" className="lg-btn lg-btn-quiet lg-btn-sm" onClick={() => setLogging(false)}>
            Close
          </button>
        </div>
      )}
    </article>
  );
}
