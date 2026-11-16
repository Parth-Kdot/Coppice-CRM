"use client";

import Link from "next/link";
import { publishHandoff, unpublishHandoff } from "@/app/(app)/[workspaceId]/capsule/actions";
import { ActionForm } from "@/components/action-form";
import type { CalendarRow, HandoffMember, OwnerView } from "@/lib/capsule";
import { longDay, plural } from "./format";
import { unappliedDates } from "./steps";

// Step 6, publish. Publishing needs at least one approved card. Every member can then read the
// approved cards, the playbook and the calendar, read-only; an owner can unpublish to keep editing.

export function StepPublish({
  workspaceId,
  year,
  view,
  members,
  calendar,
}: {
  workspaceId: string;
  year: { start: number; label: string };
  view: OwnerView | null;
  members: HandoffMember[];
  calendar: CalendarRow[];
}) {
  if (!view) {
    return (
      <div>
        <h3 className="lg-cap-steph">Publish</h3>
        <p className="lg-muted">Nothing to publish yet. Make the relationship cards first.</p>
      </div>
    );
  }
  const { counts, report } = view;
  const published = report.status === "PUBLISHED";
  const usable = counts.approved - view.cards.filter((c) => c.approved && c.hidden).length;
  const dated = calendar.filter((r) => r.date).length;
  const waiting = unappliedDates(calendar);
  const leaving = members.filter((m) => m.departingAt).length;

  return (
    <div>
      <h3 className="lg-cap-steph">Publish</h3>
      <dl className="lg-tally lg-cap-summary">
        <div>
          <dt>Cards officers will read</dt>
          <dd>{usable}</dd>
        </div>
        <div>
          <dt>Still to review</dt>
          <dd>{counts.pending}</dd>
        </div>
        <div>
          <dt>Hidden</dt>
          <dd>{counts.hidden}</dd>
        </div>
        <div>
          <dt>Re-contact dates saved</dt>
          <dd>{dated}</dd>
        </div>
        <div>
          <dt>Members marked as leaving</dt>
          <dd>{leaving}</dd>
        </div>
      </dl>
      {waiting > 0 && !published && <p className="lg-hint">{plural(waiting, "saved date is", "saved dates are")} not on its company yet. You can still publish, and apply them on the Calendar step later.</p>}

      {published ? (
        <>
          <p className="lg-cap-done" role="status">
            Published{report.publishedAt ? ` ${longDay(report.publishedAt)}` : ""}. Every member can read the capsule for {year.label}.
          </p>
          <div className="lg-cap-actionrow">
            <Link href="#published" className="lg-btn lg-btn-primary">
              See what officers see
            </Link>
            <ActionForm
              action={unpublishHandoff}
              submitLabel="Unpublish"
              confirmMessage="Hide the capsule from officers so you can keep editing it? You can publish it again."
              successMessage="Unpublished. Officers no longer see it."
              className="lg-cap-inline"
              focusAfter="[data-tour=capsule-publish]"
            >
              <input type="hidden" name="workspaceId" value={workspaceId} />
              <input type="hidden" name="reportId" value={report.id} />
            </ActionForm>
          </div>
        </>
      ) : (
        <div className="lg-cap-actionrow">
          {usable > 0 ? (
            <ActionForm action={publishHandoff} submitLabel="Publish to the board"
              primary
              successMessage="Published. Every member can read it now."
              className="lg-cap-inline"
              submitDataTour="capsule-publish"
              focusAfter=".lg-cap-actionrow a.lg-btn"
            >
              <input type="hidden" name="workspaceId" value={workspaceId} />
              <input type="hidden" name="reportId" value={report.id} />
            </ActionForm>
          ) : (
            <>
              <button type="button" className="lg-btn lg-btn-primary" disabled>
                Publish to the board
              </button>
              <p className="lg-hint">Approve at least one card on the Review step to publish.</p>
            </>
          )}
          {usable > 0 && <p className="lg-hint">Officers see only approved cards, without the bullets and cards you hid. You can unpublish later.</p>}
        </div>
      )}
    </div>
  );
}
