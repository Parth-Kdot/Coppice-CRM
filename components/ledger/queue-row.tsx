"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { useFormActions } from "@/app/demo/_ledger/form-actions";
import { ClaimChip, type ClaimView } from "./claim-chip";
import { WarningIcon } from "./icons";
import { isLongOverdue, OverdueMark } from "./overdue";
import { useNotify } from "./providers";
import "./queue.css";

// One queue row, a single ruled line: how late (glass and words), the company, the latest note in
// italic, the claim chip and the one button that fits. The chip's form runs the real claim action.
// A refusal (someone claimed first, the claim window moved) is written in the row's own margin,
// under the line, instead of a popup. Nothing wraps on a desktop screen.

export type QueueRowData = {
  id: string;
  name: string;
  // Calendar days past the follow-up date (negative: still ahead), or null for a fresh lead.
  days: number | null;
  // "Nov 2", the follow-up date, or null.
  dueOn: string | null;
  note: string | null;
  claim: ClaimView;
};

export function QueueRow({ workspaceId, row }: { workspaceId: string; row: QueueRowData }) {
  const { claimCompany } = useFormActions();
  const [state, formAction, pending] = useActionState(claimCompany, null);
  const [dismissed, setDismissed] = useState<unknown>(null);
  const notify = useNotify();

  useEffect(() => {
    if (state?.ok) notify(`Claimed ${row.name}.`);
  }, [state, notify, row.name]);

  const error = state && !state.ok && state !== dismissed ? state.error : null;
  const href = `/demo/w/${workspaceId}/companies/${row.id}`;

  return (
    <li className="lg-qrow lg-rule-row" data-od={isLongOverdue(row.days) ? "long" : undefined} data-mine={row.claim.state === "mine" || undefined}>
      <div className="lg-qgrid">
        <span className="lg-qtime">
          {row.days === null || row.dueOn === null ? (
            <span className="lg-muted">No outreach yet</span>
          ) : (
            <OverdueMark days={row.days} dueOn={row.dueOn} />
          )}
        </span>
        <span className="lg-qn">
          <Link href={href} className="lg-qopen">
            {row.name}
          </Link>
        </span>
        <span className="lg-qnote lg-quote" title={row.note ?? undefined}>
          {row.note ? <>&ldquo;{row.note}&rdquo;</> : <span className="lg-muted">No note yet</span>}
        </span>
        <form action={formAction} className="lg-qclaim">
          <input type="hidden" name="workspaceId" value={workspaceId} />
          <input type="hidden" name="companyId" value={row.id} />
          <ClaimChip claim={row.claim} companyName={row.name} pending={pending} />
        </form>
        <span className="lg-qact">
          {row.claim.state === "mine" && (
            <Link href={`${href}#log-outreach`} className="lg-btn lg-btn-sm">
              Log outreach
            </Link>
          )}
        </span>
      </div>

      {error && (
        <div className="lg-rownote" role="alert">
          <WarningIcon size={16} />
          <span>{error}</span>
          <button type="button" className="lg-btn lg-btn-quiet lg-btn-sm" onClick={() => setDismissed(state)}>
            Dismiss
          </button>
        </div>
      )}
    </li>
  );
}
