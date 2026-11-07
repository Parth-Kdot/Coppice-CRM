"use client";

import { useEffect, useRef, useState } from "react";
import { ImportChoice } from "@/components/csv-importer-choice";
import { ExistingCard, RowCard } from "@/components/csv-importer-dupcards";
import { Tick } from "@/components/ledger/marks";
import { ExitCollapse, reducedMotion } from "@/components/ledger/motion";
import { useNotify } from "@/components/ledger/providers";
import { chosenOption, choiceEffects, groupCaption, groupOptions, groupOutcome, groupsLeft, kindOf, nameIn, type ReviewGroup } from "@/lib/import-review";
import type { Quote } from "@/lib/smart-import";

// The import's duplicate review (components/csv-importer.tsx): each group of rows that may be the
// same company as each other or as one already saved, decided as a unit. Two entries get one
// question ("Which do you want to keep?"); three or more are decided row by row. Confirm moves the
// group into Decided, where Change brings it back. Every answer only adds rows to or removes them
// from the importer's skips, which is all the server is sent. Nothing is merged: importing a
// look-alike keeps both as separate companies.

type Props = {
  idPrefix: string;
  workspaceId: string;
  groups: ReviewGroup[];
  skips: Set<number>;
  // The suggested skips, to mark the suggested answer.
  suggested: Set<number>;
  choose: (row: number, skip: boolean) => void;
  confirmed: Set<string>;
  confirm: (key: string) => void;
  reopen: (key: string) => void;
  // Rows the sheet says not to contact (Smart import), shown on their card.
  doNotContact: Map<number, Quote>;
};

export const groupDomId = (idPrefix: string, key: string) => `${idPrefix}-grp-${key}`;
const headingId = (idPrefix: string, key: string) => `${groupDomId(idPrefix, key)}-h`;

function GroupCard({
  idPrefix,
  workspaceId,
  group,
  index,
  total,
  skips,
  suggested,
  choose,
  doNotContact,
  onConfirm,
}: Omit<Props, "groups" | "confirmed" | "confirm" | "reopen"> & { group: ReviewGroup; index: number; total: number; onConfirm: () => void }) {
  const kind = kindOf(group);
  const options = groupOptions(group);
  const chosen = chosenOption(group, skips);
  const suggestedValue = chosenOption(group, suggested);
  const names = [...group.rows.map((r) => nameIn(group, r.row)), ...group.existing.map((c) => `${c.name} in Coppice`)];
  return (
    <div id={groupDomId(idPrefix, group.key)} className="lg-group lg-dupgroup" role="group" aria-labelledby={headingId(idPrefix, group.key)}>
      <div className="lg-group-head">
        <p className="lg-tag lg-group-count">
          Group {index + 1} of {total}
        </p>
        <h4 id={headingId(idPrefix, group.key)} tabIndex={-1} className="lg-group-q">
          {names.length <= 4 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : `${names.length} entries that look alike`}
        </h4>
        <p className="lg-group-why">{group.reasons.join(". ")}</p>
      </div>
      <div className="lg-group-cols">
        {group.existing.map((company) => (
          <ExistingCard key={company.id} workspaceId={workspaceId} company={company} />
        ))}
        {group.rows.map((entry) => (
          <RowCard key={entry.row} group={group} entry={entry} skipped={skips.has(entry.row)} choose={choose} dnc={doNotContact.get(entry.row)} withSwitch={kind === "rows"} />
        ))}
      </div>
      {kind !== "rows" && chosen !== null && (
        <ImportChoice
          layout="list"
          className="lg-groupchoice"
          question={kind === "pair" ? "Which do you want to keep?" : "What should happen to this row?"}
          value={chosen}
          onChange={(value) => {
            for (const effect of choiceEffects(group, value)) choose(effect.row, effect.skip);
          }}
          caption={groupCaption(group, skips)}
          options={options.map((o) => ({ value: o.value, label: o.label, suggested: o.value === suggestedValue }))}
        />
      )}
      {kind === "rows" && (
        <p className="lg-hint mt-3">
          {group.rows.length === 1 ? "Choose for this row." : "Choose for each row."} {groupCaption(group, skips)}
        </p>
      )}
      <div className="lg-group-foot">
        <button type="button" className="lg-btn lg-btn-primary" onClick={onConfirm}>
          Confirm
        </button>
        <span className="lg-hint">Saves this choice for the import and moves on.</span>
      </div>
    </div>
  );
}

export function DuplicateGroups({ idPrefix, workspaceId, groups, skips, suggested, choose, confirmed, confirm, reopen, doNotContact }: Props) {
  const notify = useNotify();
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const [entering, setEntering] = useState<string | null>(null);
  // Where focus goes once a leaving group is gone: the next group's heading, or the done line.
  const focusNext = useRef<string | null>(null);
  const doneId = `${idPrefix}-groups-done`;

  const pending = groups.filter((g) => !confirmed.has(g.key));
  const decided = groups.filter((g) => confirmed.has(g.key));

  // A reopened group gets focus once it is back in the list.
  useEffect(() => {
    if (entering) document.getElementById(headingId(idPrefix, entering))?.focus();
  }, [entering, idPrefix]);

  // When the last open group has left, the done line takes focus, once it is on the page.
  const focusDone = useRef(false);
  const openCount = pending.length;
  useEffect(() => {
    if (openCount > 0 || !focusDone.current) return;
    focusDone.current = false;
    const el = document.getElementById(doneId);
    if (!el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
  }, [openCount, doneId]);

  if (groups.length === 0) return null;

  const onConfirm = (group: ReviewGroup) => {
    const open = pending.filter((g) => g.key !== group.key && !leaving.has(g.key));
    const at = pending.indexOf(group);
    const next = open.find((g) => pending.indexOf(g) > at) ?? open[0] ?? null;
    notify(`${groupOutcome(group, skips)} ${groupsLeft(open.length)}`);
    setLeaving((current) => new Set([...current, group.key]));
    setEntering(null);
    focusNext.current = next ? headingId(idPrefix, next.key) : doneId;
    // Focus moves now, so it never sits on a block that is going away.
    if (next) document.getElementById(headingId(idPrefix, next.key))?.focus({ preventScroll: true });
  };

  const onLeft = (key: string) => {
    setLeaving((current) => {
      const nextSet = new Set(current);
      nextSet.delete(key);
      return nextSet;
    });
    const target = focusNext.current;
    focusNext.current = null;
    if (target === doneId) focusDone.current = true;
    confirm(key);
    if (!target || target === doneId) return;
    window.requestAnimationFrame(() => {
      const el = document.getElementById(target);
      if (!el) return;
      if (document.activeElement !== el) el.focus({ preventScroll: true });
      // The whole group, "Group i of N" included, comes into view under the sticky summary (its
      // scroll-margin is the bar's height), not just its heading.
      // "start", since a group taller than the screen with its top above it isn't moved by "nearest".
      (el.closest(".lg-dupgroup") ?? el).scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
    });
  };

  return (
    <section className="lg-groups" aria-labelledby={`${idPrefix}-dup-h`}>
      <h3 id={`${idPrefix}-dup-h`} className="lg-h3">
        Possible duplicates
      </h3>
      <p className="lg-hint mb-1">
        Coppice found rows that may be the same company. Pick what to keep in each group, then press Confirm. A group you don&apos;t confirm uses the choice
        shown. Nothing is imported until you press Import.
      </p>
      {pending.length === 0 ? (
        <p id={doneId} tabIndex={-1} className="lg-groups-done">
          <Tick size={18} />
          <span>
            Every group is decided. Change any of them under Decided, or import below.
          </span>
        </p>
      ) : (
        pending.map((group) => (
          <ExitCollapse key={group.key} leaving={leaving.has(group.key)} entering={entering === group.key} onLeft={() => onLeft(group.key)}>
            <GroupCard
              idPrefix={idPrefix}
              workspaceId={workspaceId}
              group={group}
              index={groups.indexOf(group)}
              total={groups.length}
              skips={skips}
              suggested={suggested}
              choose={choose}
              doNotContact={doNotContact}
              onConfirm={() => onConfirm(group)}
            />
          </ExitCollapse>
        ))
      )}
      {decided.length > 0 && (
        <details className="lg-decided">
          <summary>Decided ({decided.length})</summary>
          <ul>
            {decided.map((group) => (
              <li key={group.key}>
                <span>
                  <span className="lg-tag lg-muted">Group {groups.indexOf(group) + 1}</span> {groupOutcome(group, skips)}
                </span>
                <button
                  type="button"
                  className="lg-btn lg-btn-sm"
                  aria-label={`Change group ${groups.indexOf(group) + 1}`}
                  onClick={() => {
                    reopen(group.key);
                    setEntering(group.key);
                  }}
                >
                  Change
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
