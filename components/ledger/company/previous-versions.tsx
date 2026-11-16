"use client";

import { useEffect, useState } from "react";
import { ActionForm } from "@/components/action-form";
import { PREVIOUS_VERSION_MS, RESTORED, replacedLine, type PreviousItem } from "@/lib/previous-versions-copy";
import { Disclosure } from "../disclosure";
import { focusSoon } from "../focus";
import { useNotify } from "../providers";
import type { Action } from "./types";
import "../company.css";

// Previous versions on the company page: the value each field held before its latest change, for an
// hour after it (lib/previous-versions.ts). The ages come from the database clock when the page was
// drawn; from then on the list counts forward with the time spent on this page (never the browser's
// own clock, which can be wrong), so "12 min ago" stays true and a row leaves when its hour is up. A
// row that ran out while the computer slept is refused by the server with a plain sentence, written
// as a margin note, and the page redraws without it. The page passes drawnAt (the database time of
// its render), which restarts the count from the fresh ages and remounts only the inner list, so the
// person's open or closed choice on the box survives other actions on the page.

// Milliseconds spent on this page since it was drawn. It starts again from 0 whenever drawnAt changes.
function useElapsed(drawnAt: number): number {
  const [seen, setSeen] = useState({ drawnAt, elapsed: 0 });
  useEffect(() => {
    const start = performance.now();
    const timer = window.setInterval(() => setSeen({ drawnAt, elapsed: performance.now() - start }), 30_000);
    return () => window.clearInterval(timer);
  }, [drawnAt]);
  return seen.drawnAt === drawnAt ? seen.elapsed : 0;
}

type Ids = { workspaceId: string; companyId: string };

function PreviousRow({ item, age, ids, restore }: { item: PreviousItem; age: number; ids: Ids; restore: Action }) {
  const notify = useNotify();
  // A refusal is written as a margin note (the form does not repeat it under the button), which
  // survives the redraw that follows, and focus goes where it would after a restore, so it never
  // falls to the page body when the row leaves.
  const run: Action = async (prev, form) => {
    const result = await restore(prev, form);
    if (!result.ok) {
      notify(result.error, "error");
      focusSoon(item.focusAfter);
    }
    return result;
  };
  return (
    <li className="lg-prev">
      <p className="lg-prev-head">
        <span className="lg-tag">{item.label}</span>
        <span className="lg-hint" title={item.exactTime}>
          {replacedLine(item, age)}
        </span>
      </p>
      {item.value === null ? (
        <p className="lg-prev-value lg-muted">Empty</p>
      ) : item.long ? (
        <Disclosure summary={`Show the previous ${item.label.toLowerCase()}`} variant="inline" className="lg-prev-more">
          <p className="lg-prev-value lg-prev-long">{item.value}</p>
        </Disclosure>
      ) : (
        <p className="lg-prev-value">{item.value}</p>
      )}
      <ActionForm
        action={run}
        submitLabel="Restore"
        small
        submitAriaLabel={item.restoreLabel}
        quietError
        successMessage={RESTORED}
        focusAfter={item.focusAfter}
        className="lg-prev-form flex flex-wrap items-center gap-2"
      >
        <input type="hidden" name="workspaceId" value={ids.workspaceId} />
        <input type="hidden" name="companyId" value={ids.companyId} />
        <input type="hidden" name="versionId" value={item.versionId} />
        <input type="hidden" name="expected" value={item.expected} />
        <input type="hidden" name="field" value={item.field} />
        <input type="hidden" name="contactId" value={item.contactId ?? ""} />
      </ActionForm>
    </li>
  );
}

function PreviousList({ items, elapsed, ids, restore }: { items: PreviousItem[]; elapsed: number; ids: Ids; restore: Action }) {
  return (
    <ul className="lg-prevlist">
      {items.map((item) => (
        <PreviousRow key={item.versionId} item={item} age={item.ageMs + elapsed} ids={ids} restore={restore} />
      ))}
    </ul>
  );
}

// boxed: the company's own list, inside "Previous versions" (open for anyone who made one of these
// changes, closed for everyone else). Unboxed: a contact's few rows, straight under the contact.
export function PreviousVersions({
  items,
  ids,
  restore,
  boxed,
  drawnAt,
  defaultOpen = false,
}: {
  items: PreviousItem[];
  ids: Ids;
  restore: Action;
  boxed: boolean;
  drawnAt: number;
  defaultOpen?: boolean;
}) {
  const elapsed = useElapsed(drawnAt);
  // The box opens by the first render's answer only. defaultOpen turns false when the viewer's last
  // own row goes (its hour, someone else's overwrite, a refused restore), and the box must not snap
  // shut on the rows that are left.
  const [openAtFirst] = useState(defaultOpen);
  const live = items.filter((i) => i.ageMs + elapsed < PREVIOUS_VERSION_MS);
  if (live.length === 0) return null;
  const list = <PreviousList key={drawnAt} items={live} elapsed={elapsed} ids={ids} restore={restore} />;
  if (!boxed) return list;
  return (
    <Disclosure summary="Previous versions" count={live.length} variant="inline" defaultOpen={openAtFirst} className="lg-prevbox" id="previous-versions">
      {list}
    </Disclosure>
  );
}
