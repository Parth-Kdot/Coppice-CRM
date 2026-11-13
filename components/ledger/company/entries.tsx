"use client";

import { useState, type ReactNode } from "react";
import type { Channel, Stage, Via } from "@/generated/prisma/enums";
import { CHANNEL_LABELS } from "@/lib/channels";
import type { ReplyChoice } from "@/lib/companies";
import { TIME_ZONE } from "@/lib/dates";
import { STAGE_LABELS } from "@/lib/stages";
import { boardYear } from "../board-year";
import { Disclosure } from "../disclosure";
import { focusSoon } from "../focus";
import { TurnoverRule } from "../marks";
import { ReplyPrompt } from "../reply-prompt";
import { Empty } from "../shared";
import { MoreLink, ShowMore } from "../show-more";
import { Clamp } from "./block";
import "../company.css";
import "../templates.css";

// The outreach log and the history: dated entries, newest first, with the double rule where one
// board's entries end and an older board's begin.

// "Nov 21", with the year when it isn't this year ("Nov 21, 2025"), and the time when two entries
// of the same list share a day.
function dateLabel(date: Date, thisYear: number, withTime: boolean): string {
  const year = Number(date.toLocaleDateString("en-US", { timeZone: TIME_ZONE, year: "numeric" }));
  const text = date.toLocaleDateString("en-US", { timeZone: TIME_ZONE, month: "short", day: "numeric", ...(year !== thisYear ? { year: "numeric" } : {}) });
  return withTime ? `${text}, ${date.toLocaleTimeString("en-US", { timeZone: TIME_ZONE, hour: "numeric", minute: "2-digit" })}` : text;
}
const dayKey = (date: Date) => date.toLocaleDateString("en-CA", { timeZone: TIME_ZONE });
function sharedDays(dates: Date[]): Set<string> {
  const seen = new Set<string>();
  const shared = new Set<string>();
  for (const d of dates) {
    const k = dayKey(d);
    if (seen.has(k)) shared.add(k);
    seen.add(k);
  }
  return shared;
}

// via: ASSISTANT when the person's AI assistant logged it through the MCP server.
export type OutreachData = {
  id: string;
  channel: Channel;
  note: string | null;
  sentAt: Date;
  aiDraftId: string | null;
  gotReply: boolean;
  via?: Via;
  sender: { name: string };
  template: { name: string } | null;
};

// Where one board's entries end and an older board's begin: the double rule, drawn at the top of
// the first older entry (newest first, so the board above it has ended).
function turnoverBefore(at: Date, newer: Date | undefined): ReactNode {
  if (!newer || boardYear(newer).start === boardYear(at).start) return null;
  return <TurnoverRule endsYear={boardYear(at).long} />;
}

// One ledger line: the date in the margin, then who, how and the note.
function OutreachEntry({ o, label, turnover }: { o: OutreachData; label: string; turnover: ReactNode }) {
  const by = [o.sender.name, CHANNEL_LABELS[o.channel], o.aiDraftId ? "from an AI draft" : null, o.template ? `template: ${o.template.name}` : null].filter(Boolean).join(" · ");
  return (
    <li className="lg-entry" data-entry-id={o.id}>
      {turnover}
      <div className="lg-entryline">
        <time className="lg-entrydate" dateTime={o.sentAt.toISOString()}>
          {label}
        </time>
        <div className="lg-entrybody">
          <p className="lg-entryby lg-wrap-any">
            {o.gotReply && <span className="lg-badge lg-replied">Got the reply</span>}
            {by}
            {o.via === "ASSISTANT" && <span className="lg-via">via assistant</span>}
          </p>
          {o.note && <Clamp text={o.note} className="lg-entrynote" />}
        </div>
      </div>
    </li>
  );
}

const toChoice = (o: OutreachData): ReplyChoice => ({
  id: o.id,
  sentAt: o.sentAt,
  channel: o.channel,
  senderName: o.sender.name,
  templateName: o.template?.name ?? null,
  aiDrafted: o.aiDraftId !== null,
  note: o.note,
  gotReply: o.gotReply,
});

// One "Mark which one got the reply" link for a company in a reply stage, opening the same question
// a stage move asks (ReplyPrompt), over the latest ten entries.
function MarkReply({ workspaceId, companyId, companyName, outreach }: { workspaceId: string; companyId: string; companyName: string; outreach: OutreachData[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <p className="lg-markreply">
        <button type="button" className="lg-linkbtn" onClick={() => setOpen(true)}>
          Mark which one got the reply
        </button>
      </p>
      {open && (
        <ReplyPrompt
          workspaceId={workspaceId}
          companyId={companyId}
          companyName={companyName}
          choices={outreach.slice(0, 10).map(toChoice)}
          onDone={() => {
            setOpen(false);
            // The link goes once an entry is marked, so the block's heading takes focus.
            focusSoon("#outreach-h");
          }}
        />
      )}
    </>
  );
}

// `older`: the page was asked for older entries (?outreach=all). The "Show more" link then stays in
// place as "Showing all 200.", so the focus it had lands there instead of on <body>.
function OutreachList({ outreach, total, thisYear, olderHref, older = false }: { outreach: OutreachData[]; total: number; thisYear: number; olderHref: string; older?: boolean }) {
  const shared = sharedDays(outreach.map((o) => o.sentAt));
  return (
    <>
      <ShowMore initial={5} label="outreach entries" as="ol" listClassName="lg-entries">
        {outreach.map((o, i) => (
          <OutreachEntry key={o.id} o={o} label={dateLabel(o.sentAt, thisYear, shared.has(dayKey(o.sentAt)))} turnover={turnoverBefore(o.sentAt, outreach[i - 1]?.sentAt)} />
        ))}
      </ShowMore>
      {(total > outreach.length || older) && (
        <>
          {total > outreach.length && (
            <p className="lg-hint lg-older">
              Showing the latest {outreach.length.toLocaleString("en-US")} of {total.toLocaleString("en-US")}.
            </p>
          )}
          <MoreLink href={olderHref} shown={outreach.length} total={total} step={400} cap={500} />
        </>
      )}
    </>
  );
}

export function OutreachBlock({
  workspaceId,
  companyId,
  companyName,
  outreach,
  total,
  thisYear,
  olderHref,
  older,
  canMarkReply,
  claimable,
}: {
  workspaceId: string;
  companyId: string;
  companyName: string;
  claimable: boolean;
  outreach: OutreachData[];
  total: number;
  thisYear: number;
  olderHref: string;
  older: boolean;
  canMarkReply: boolean;
}) {
  return (
    <section className="lg-block" id="outreach" aria-labelledby="outreach-h">
      <h2 id="outreach-h" className="lg-bh" tabIndex={-1}>
        Outreach
        {total > 0 && <span className="lg-bh-count">{total.toLocaleString("en-US")}</span>}
      </h2>
      {outreach.length === 0 ? (
        <Empty kind="outreach">
          <p className="lg-empty-title">No outreach logged yet.</p>
          {claimable && <p>Claim it if it is free, then log your first email or call.</p>}
        </Empty>
      ) : (
        <>
          {canMarkReply && !outreach.some((o) => o.gotReply) && <MarkReply workspaceId={workspaceId} companyId={companyId} companyName={companyName} outreach={outreach} />}
          <OutreachList outreach={outreach} total={total} thisYear={thisYear} olderHref={olderHref} older={older} />
        </>
      )}
    </section>
  );
}

type ChangeData = { id: string; fromStage: Stage; toStage: Stage; changedAt: Date; via?: Via; changedBy: { name: string } };

function StageMoves({ changes, total, thisYear, olderHref, older }: { changes: ChangeData[]; total: number; thisYear: number; olderHref: string; older: boolean }) {
  const shared = sharedDays(changes.map((c) => c.changedAt));
  if (changes.length === 0) return <p className="lg-muted">No stage moves yet.</p>;
  return (
    <>
      <ShowMore initial={10} label="stage moves" as="ol" listClassName="lg-entries lg-history">
        {changes.map((s, i) => (
          <li key={s.id} className="lg-entry">
            {turnoverBefore(s.changedAt, changes[i - 1]?.changedAt)}
            <div className="lg-entryline">
              <time className="lg-entrydate" dateTime={s.changedAt.toISOString()}>
                {dateLabel(s.changedAt, thisYear, shared.has(dayKey(s.changedAt)))}
              </time>
              <p className="lg-entrybody">
                {s.changedBy.name} moved it from {STAGE_LABELS[s.fromStage]} to {STAGE_LABELS[s.toStage]}
                {s.via === "ASSISTANT" && <span className="lg-via">via assistant</span>}
              </p>
            </div>
          </li>
        ))}
      </ShowMore>
      {(total > changes.length || older) && (
        <>
          {total > changes.length && (
            <p className="lg-hint lg-older">
              Showing the latest {changes.length.toLocaleString("en-US")} of {total.toLocaleString("en-US")}.
            </p>
          )}
          <MoreLink href={olderHref} shown={changes.length} total={total} step={450} cap={500} />
        </>
      )}
    </>
  );
}

// "History", collapsed at the bottom with its count: the stage moves, and for an archived company
// the outreach log too (`outreach`), since nothing else on its page is in play.
export function HistoryBlock({
  changes,
  total,
  thisYear,
  olderHref,
  outreach,
  defaultOpen = false,
}: {
  changes: ChangeData[];
  total: number;
  thisYear: number;
  olderHref: string;
  outreach?: { list: OutreachData[]; total: number; olderHref: string; older: boolean };
  defaultOpen?: boolean;
}) {
  const count = total + (outreach?.total ?? 0);
  return (
    <Disclosure summary="History" count={count} id="history" defaultOpen={defaultOpen} className="lg-codisc">
      {outreach && (
        <>
          <h3 className="lg-h3 lg-subhead">Outreach</h3>
          {outreach.list.length === 0 ? (
            <p className="lg-muted">No outreach logged.</p>
          ) : (
            <OutreachList outreach={outreach.list} total={outreach.total} thisYear={thisYear} olderHref={outreach.olderHref} older={outreach.older} />
          )}
          <h3 className="lg-h3 lg-subhead">Stage moves</h3>
        </>
      )}
      <StageMoves changes={changes} total={total} thisYear={thisYear} olderHref={olderHref} older={defaultOpen} />
    </Disclosure>
  );
}
