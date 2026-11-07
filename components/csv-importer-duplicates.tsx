"use client";

import { useMemo, useRef, useState } from "react";
import { ImportChoice } from "@/components/csv-importer-choice";
import { ExistingCard, RowCard } from "@/components/csv-importer-dupcards";
import { Disclosure } from "@/components/ledger/disclosure";
import { focusSoon } from "@/components/ledger/focus";
import { Tick } from "@/components/ledger/marks";
import { completeStamp, removeAway } from "@/components/ledger/motion-kit";
import { useNotify } from "@/components/ledger/providers";
import { ShowMore } from "@/components/ledger/show-more";
import { bulkAnswers, chosenOption, choiceEffects, groupOptions, groupOutcome, groupsLeft, kindOf, nameIn, type ReviewGroup } from "@/lib/import-review";
import type { Quote } from "@/lib/smart-import";

// The import's duplicate review (components/csv-importer.tsx), one group at a time: "Group 2 of 6",
// its question and answers, Confirm, and Back / Next to move between the groups still open. When
// five or more open groups share a kind, one line above decides them all ("Skip all 12 already in
// Coppice"). Confirmed groups fold into "Decided", where Change brings one back. Every answer only
// adds rows to or removes them from the importer's skips, which is all the server is sent. Nothing
// is merged: importing a look-alike keeps both as separate companies. Confirm is the one moment
// with motion: the group slides away (the motion kit's removeAway), the next one rises into its
// place, and the last one ends on a stamped "Every group is decided."

type Props = {
  idPrefix: string;
  workspaceId: string;
  groups: ReviewGroup[];
  skips: Set<number>;
  // The suggested skips, to mark the suggested answer.
  suggested: Set<number>;
  choose: (row: number, skip: boolean) => void;
  chooseMany: (effects: { row: number; skip: boolean }[]) => void;
  confirmed: Set<string>;
  confirm: (keys: string[]) => void;
  reopen: (key: string) => void;
  // The group shown, and a way to show another (the importer keeps it, so it can jump there).
  current: string | null;
  setCurrent: (key: string | null) => void;
  // Rows the sheet says not to contact (Smart import), shown on their card.
  doNotContact: Map<number, Quote>;
};

export const groupDomId = (idPrefix: string, key: string) => `${idPrefix}-grp-${key}`;
export const groupHeadingId = (idPrefix: string, key: string) => `${groupDomId(idPrefix, key)}-h`;

function GroupCard({
  idPrefix,
  workspaceId,
  group,
  position,
  total,
  skips,
  suggested,
  choose,
  doNotContact,
  rise,
  onConfirm,
  onBack,
  onNext,
}: Pick<Props, "idPrefix" | "workspaceId" | "skips" | "suggested" | "choose" | "doNotContact"> & {
  group: ReviewGroup;
  position: number;
  total: number;
  // Rises into place: it follows a group just confirmed.
  rise: boolean;
  onConfirm: () => void;
  onBack: (() => void) | null;
  onNext: (() => void) | null;
}) {
  const kind = kindOf(group);
  const options = groupOptions(group);
  const chosen = chosenOption(group, skips);
  const suggestedValue = chosenOption(group, suggested);
  const names = [...group.rows.map((r) => nameIn(group, r.row)), ...group.existing.map((c) => `${c.name} in Coppice`)];
  return (
    <div
      id={groupDomId(idPrefix, group.key)}
      className="lg-group lg-dupgroup"
      role="group"
      aria-labelledby={groupHeadingId(idPrefix, group.key)}
      data-tour="dup-group"
      data-rise={rise || undefined}
    >
      <div className="lg-group-head">
        <p className="lg-tag lg-group-count">
          Group {position.toLocaleString("en-US")} of {total.toLocaleString("en-US")}
        </p>
        <h3 id={groupHeadingId(idPrefix, group.key)} tabIndex={-1} className="lg-group-q">
          {names.length <= 4 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : `${names.length} entries that look alike`}
        </h3>
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
          options={options.map((o) => ({ value: o.value, label: o.label, suggested: o.value === suggestedValue }))}
        />
      )}
      <div className="lg-group-foot">
        <button type="button" className="lg-btn" onClick={onConfirm}>
          Confirm
        </button>
        {(onBack || onNext) && (
          <span className="lg-group-nav">
            <button type="button" className="lg-linkbtn" disabled={!onBack} onClick={onBack ?? undefined}>
              Back
            </button>
            <button type="button" className="lg-linkbtn" disabled={!onNext} onClick={onNext ?? undefined}>
              Next
            </button>
          </span>
        )}
      </div>
    </div>
  );
}

export function DuplicateGroups({ idPrefix, workspaceId, groups, skips, suggested, choose, chooseMany, confirmed, confirm, reopen, current, setCurrent, doNotContact }: Props) {
  const notify = useNotify();
  const doneId = `${idPrefix}-groups-done`;
  // Positions by key, so nothing searches the whole list per group.
  const position = useMemo(() => new Map(groups.map((g, i) => [g.key, i + 1])), [groups]);
  const open = useMemo(() => groups.filter((g) => !confirmed.has(g.key)), [groups, confirmed]);
  const decided = useMemo(() => groups.filter((g) => confirmed.has(g.key)), [groups, confirmed]);
  const bulk = useMemo(() => bulkAnswers(open), [open]);
  const [showBulk, setShowBulk] = useState(true);
  // The group that rises in after a Confirm, and the one on its way out (a second Enter on its
  // Confirm while it slides away does nothing).
  const [risen, setRisen] = useState<string | null>(null);
  const leaving = useRef<string | null>(null);

  if (groups.length === 0) return null;

  const at = Math.max(
    0,
    open.findIndex((g) => g.key === current),
  );
  const shown = open[at] ?? null;
  const focusGroup = (key: string | null) => focusSoon(key ? `#${CSS.escape(groupHeadingId(idPrefix, key))}` : `#${CSS.escape(doneId)}`);
  const show = (key: string) => {
    setCurrent(key);
    focusGroup(key);
  };

  const onConfirm = async (group: ReviewGroup) => {
    if (leaving.current === group.key) return;
    leaving.current = group.key;
    const rest = open.filter((g) => g.key !== group.key);
    const next = open[at + 1] ?? rest[0] ?? null;
    notify(`${groupOutcome(group, skips)} ${groupsLeft(rest.length)}`);
    // Only the screen waits on the slide: the choice itself is already in the skips.
    await removeAway(document.getElementById(groupDomId(idPrefix, group.key)));
    leaving.current = null;
    confirm([group.key]);
    setCurrent(next?.key ?? null);
    setRisen(next?.key ?? null);
    focusGroup(next?.key ?? null);
    // The last one: "Every group is decided." lands with a stamp once it is drawn.
    if (!next) requestAnimationFrame(() => void completeStamp(document.getElementById(doneId)));
  };

  return (
    <section className="lg-groups" aria-labelledby={`${idPrefix}-dup-h`}>
      <h3 id={`${idPrefix}-dup-h`} className="lg-h3">
        Possible duplicates <span className="lg-muted">{groups.length.toLocaleString("en-US")}</span>
      </h3>
      {bulk.length > 0 && showBulk && (
        <div className="lg-bulkbar" role="group" aria-label="Decide many groups at once">
          {bulk.map((answer) => (
            <button
              key={answer.kind}
              type="button"
              className="lg-btn lg-btn-sm"
              onClick={() => {
                chooseMany(answer.effects);
                confirm(answer.groups.map((g) => g.key));
                const left = open.length - answer.groups.length;
                notify(`${answer.groups.length.toLocaleString("en-US")} groups decided. ${groupsLeft(left)}`);
                const decidedNow = new Set(answer.groups.map((g) => g.key));
                const next = open.find((g) => !decidedNow.has(g.key)) ?? null;
                setCurrent(next?.key ?? null);
                focusGroup(next?.key ?? null);
              }}
            >
              {answer.label}
            </button>
          ))}
          <button type="button" className="lg-linkbtn" onClick={() => setShowBulk(false)}>
            Review one by one
          </button>
        </div>
      )}
      {shown === null ? (
        <p id={doneId} tabIndex={-1} className="lg-groups-done">
          <Tick size={18} />
          <span>Every group is decided.</span>
        </p>
      ) : (
        <GroupCard
          key={shown.key}
          idPrefix={idPrefix}
          workspaceId={workspaceId}
          group={shown}
          position={position.get(shown.key) ?? 1}
          total={groups.length}
          rise={risen === shown.key}
          skips={skips}
          suggested={suggested}
          choose={choose}
          doNotContact={doNotContact}
          onConfirm={() => void onConfirm(shown)}
          onBack={at > 0 ? () => show(open[at - 1].key) : null}
          onNext={at < open.length - 1 ? () => show(open[at + 1].key) : null}
        />
      )}
      {decided.length > 0 && (
        <Disclosure variant="inline" summary="Decided" count={decided.length} className="lg-decided">
          <ShowMore initial={10} label="decided groups" as="ul">
            {decided.map((group) => {
              const n = position.get(group.key) ?? 0;
              return (
                <li key={group.key}>
                  <span className="lg-wrap-any">
                    <span className="lg-tag lg-muted">Group {n}</span> {groupOutcome(group, skips)}
                  </span>
                  <button
                    type="button"
                    className="lg-linkbtn"
                    aria-label={`Change group ${n}`}
                    onClick={() => {
                      reopen(group.key);
                      setCurrent(group.key);
                      focusGroup(group.key);
                    }}
                  >
                    Change
                  </button>
                </li>
              );
            })}
          </ShowMore>
        </Disclosure>
      )}
    </section>
  );
}
