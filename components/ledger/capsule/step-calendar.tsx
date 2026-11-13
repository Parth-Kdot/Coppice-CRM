"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { applyCalendar, fillBlankDates, reopenForNextYear, saveRecontactDates } from "@/app/(app)/[workspaceId]/capsule/actions";
import { ActionForm } from "@/components/action-form";
import type { AppliedDates, CalendarRow, OwnerView } from "@/lib/capsule";
import { addDays, formatYmd } from "@/lib/dates";
import { ErrorLine } from "../shared";
import { StageChip } from "./card-parts";
import { plural } from "./format";
import { unappliedDates } from "./steps";
import { plain, useRun } from "./use-run";

// Step 5, the re-contact calendar. Each approved card proposes a date from its "next" bullets, and
// the page shows the proposal beside the date saved. The owner can change any date, set every blank
// to one date, and Apply: each saved date goes on its company through setFollowUp, one company
// after another, and what was set and what was refused (a company someone else holds, a date that
// has passed) is listed with the reason. A Committed company takes no date while closed: its row
// has "Reopen for next year", one company at a time, after a confirmation. Declined companies are
// listed and left alone.

const day = (ymd: string) => formatYmd(ymd, { month: "short", day: "numeric", year: "numeric" });

type Entry = { companyId: string; date: string | null };

export function StepCalendar({ workspaceId, view, rows, today, locked }: { workspaceId: string; view: OwnerView | null; rows: CalendarRow[]; today: string; locked: boolean }) {
  if (!view || rows.length === 0) {
    return (
      <div>
        <h3 className="lg-cap-steph">Re-contact calendar</h3>
        <p className="lg-muted">No card is approved yet, so there is nothing to schedule. Approve cards on the Review step first.</p>
      </div>
    );
  }
  return <Calendar workspaceId={workspaceId} reportId={view.report.id} rows={rows} today={today} locked={locked} />;
}

type Report = {
  applied: AppliedDates | null;
  setApplied: (value: AppliedDates | null) => void;
  note: string | null;
  setNote: (value: string | null) => void;
  saveRefused: { companyId: string; reason: string }[];
  setSaveRefused: (value: { companyId: string; reason: string }[]) => void;
};

function Calendar({ workspaceId, reportId, rows, today, locked }: { workspaceId: string; reportId: string; rows: CalendarRow[]; today: string; locked: boolean }) {
  // What happened on the last click is kept here, above the rows: the rows start over each time
  // the saved dates change, so edits made on the page give way to what the server holds.
  const [applied, setApplied] = useState<AppliedDates | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [saveRefused, setSaveRefused] = useState<{ companyId: string; reason: string }[]>([]);
  const signature = rows.map((r) => `${r.cardId}:${r.date ?? ""}:${r.followUp ?? ""}:${r.closed ?? ""}`).join("|");
  return (
    <CalendarRows
      key={signature}
      workspaceId={workspaceId}
      reportId={reportId}
      rows={rows}
      today={today}
      locked={locked}
      report={{ applied, setApplied, note, setNote, saveRefused, setSaveRefused }}
    />
  );
}

function CalendarRows({ workspaceId, reportId, rows, today, locked, report }: { workspaceId: string; reportId: string; rows: CalendarRow[]; today: string; locked: boolean; report: Report }) {
  const router = useRouter();
  const save = useRun(saveRecontactDates);
  const fill = useRun(fillBlankDates);
  const apply = useRun(applyCalendar);
  const { applied, setApplied, note, setNote, saveRefused, setSaveRefused } = report;
  const [dates, setDates] = useState<Record<string, string>>(() => Object.fromEntries(rows.map((r) => [r.companyId, r.date ?? ""])));
  const [blankDate, setBlankDate] = useState("");

  const max = addDays(today, 365);
  const open = rows.filter((r) => !r.closed);
  const dirty = open.filter((r) => (dates[r.companyId] ?? "") !== (r.date ?? ""));
  const nameOf = (companyId: string) => rows.find((r) => r.companyId === companyId)?.name ?? "A company";
  const toApply = unappliedDates(rows) + dirty.filter((r) => dates[r.companyId]).length;
  const blanks = open.filter((r) => !dates[r.companyId]).length;
  const busy = save.pending || fill.pending || apply.pending;

  const flush = async (): Promise<boolean> => {
    setSaveRefused([]);
    if (dirty.length === 0) return true;
    const entries: Entry[] = dirty.map((r) => ({ companyId: r.companyId, date: dates[r.companyId] || null }));
    const result = await save.run({ workspaceId, reportId, dates: JSON.stringify(entries) });
    if (!result?.ok) return false;
    setSaveRefused(result.data.refused);
    return true;
  };
  const onFill = async () => {
    setApplied(null);
    setNote(null);
    if (!(await flush())) return;
    const result = await fill.run({ workspaceId, reportId, date: blankDate });
    if (result?.ok) {
      setNote(result.data.set === 0 ? "No blank dates were left to set." : `Set ${plural(result.data.set, "blank date", "blank dates")} to ${day(blankDate)}.`);
      router.refresh();
    }
  };
  const onApply = async () => {
    setApplied(null);
    setNote(null);
    if (!(await flush())) return;
    const result = await apply.run({ workspaceId, reportId });
    if (result?.ok) setApplied(result.data);
    router.refresh();
  };

  return (
    <div>
      <h3 className="lg-cap-steph">Re-contact calendar</h3>
      <p className="lg-muted lg-cap-stepsub">
        A card with a next step that names a month proposes the first day of that month. Change any date, or leave it blank. Apply puts each date on its company as its next follow-up. Nothing else about the company changes.
      </p>

      {!locked && (
        <div className="lg-cap-caltools">
          <div className="lg-cap-fill">
            <label className="lg-label" htmlFor="cap-fill-date">
              Set every blank to one date
            </label>
            <div className="lg-cap-fillrow">
              <input id="cap-fill-date" type="date" className="lg-input lg-cap-date" min={today} max={max} value={blankDate} onChange={(e) => setBlankDate(e.target.value)} />
              <button type="button" className="lg-btn" disabled={busy || !blankDate || blanks === 0} onClick={onFill}>
                Set blanks
              </button>
            </div>
          </div>
          <div className="lg-cap-applybox">
            <button type="button" className={`lg-btn ${toApply > 0 ? "lg-btn-primary" : ""}`} disabled={busy || toApply === 0} onClick={onApply}>
              {apply.pending ? "Applying..." : toApply > 0 ? `Apply ${plural(toApply, "date", "dates")} to companies` : "Apply to companies"}
            </button>
            <p className="lg-hint">{toApply > 0 ? "Each date is set one company at a time, and anything refused is listed." : "Every saved date is already on its company."}</p>
          </div>
        </div>
      )}
      {note && (
        <p className="lg-cap-done" role="status">
          {note}
        </p>
      )}
      <ErrorLine>{save.error ?? fill.error ?? apply.error}</ErrorLine>

      {saveRefused.length > 0 && (
        <div className="lg-cap-refused" role="status">
          <p>Not saved:</p>
          <ul>
            {saveRefused.map((r) => (
              <li key={r.companyId}>
                <strong>{nameOf(r.companyId)}</strong>: {r.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      {applied && (
        <div className="lg-cap-applied" role="status">
          <p className="lg-cap-done">
            {applied.set.length === 0 ? "No follow-up date was set." : `Set ${plural(applied.set.length, "follow-up date", "follow-up dates")}.`}
            {applied.refused.length > 0 && ` ${plural(applied.refused.length, "company was", "companies were")} refused.`}
          </p>
          {applied.refused.length > 0 && (
            <ul className="lg-cap-refusals">
              {applied.refused.map((r) => (
                <li key={r.companyId}>
                  <strong>{r.name}</strong>: {r.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <ul className="lg-cap-calrows">
        {rows.map((row) => {
          const value = dates[row.companyId] ?? "";
          return (
            <li key={row.cardId} className="lg-cap-calrow" data-closed={row.closed ?? undefined} data-card={row.cardId}>
              <div className="lg-cap-calname">
                <Link className="lg-link" href={`/${workspaceId}/companies/${row.companyId}`}>
                  {row.name}
                </Link>
                <StageChip stage={row.stage} />
              </div>
              <div className="lg-cap-calctl">
                {row.closed === "DECLINED" && <p className="lg-hint">Declined. Left alone, so it gets no date.</p>}
                {row.closed === "COMMITTED" && (
                  <>
                    <p className="lg-hint">Closed deals take no date until reopened.{row.date ? ` Its date, ${day(row.date)}, waits.` : ""}</p>
                    {!locked && (
                      <ActionForm
                        action={plain(reopenForNextYear)}
                        submitLabel="Reopen for next year"
                        submitAriaLabel={`Reopen ${row.name} for next year`}
                        small
                        confirmMessage={`Move ${row.name} back to Contacted so it can take a follow-up date? The move is recorded in its history.`}
                        successMessage={`${row.name} is Contacted again.`}
                        className="lg-cap-inline"
                        focusAfter={`[data-card="${row.cardId}"] input[type=date]`}
                      >
                        <input type="hidden" name="workspaceId" value={workspaceId} />
                        <input type="hidden" name="cardId" value={row.cardId} />
                      </ActionForm>
                    )}
                  </>
                )}
                {!row.closed && (
                  <>
                    {locked ? (
                      <p className="lg-num">{row.date ? day(row.date) : "No date"}</p>
                    ) : (
                      <input
                        type="date"
                        className="lg-input lg-cap-date"
                        aria-label={`Re-contact date for ${row.name}`}
                        min={today}
                        max={max}
                        value={value}
                        onChange={(e) => {
                          setApplied(null);
                          setDates((d) => ({ ...d, [row.companyId]: e.target.value }));
                        }}
                      />
                    )}
                    <p className="lg-hint lg-cap-calhint">
                      {row.proposed ? `Proposed ${day(row.proposed)}.` : "Nothing proposed."}
                      {row.proposed && row.date && row.proposed !== row.date ? ` Saved ${day(row.date)}.` : ""}
                      {row.followUp ? ` On the company now: ${day(row.followUp)}.` : ""}
                    </p>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
