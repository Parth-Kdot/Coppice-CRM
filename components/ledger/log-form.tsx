"use client";

import { useId, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import "@/components/ledger/zod-jitless";
import { ActionForm } from "@/components/action-form";
import { CHANNEL_LABELS, CHANNELS } from "@/lib/channels";
import { addDays } from "@/lib/dates";
import { NOTE_MAX, type ActionResult } from "@/lib/validation";
import type { Channel } from "@/generated/prisma/enums";
import { ChipGroup, type ChipOption } from "./chips";
import { CalendarPopover } from "./date-popover";
import { formatYmd } from "./ymd";
import "./company.css";

// The fast log form. Logging is a channel chip, when to follow up (3, 7 or 14 days, or a picked day,
// with 7 preselected) and a note. Every choice is a real radio input drawn as a chip, and "Pick"
// opens a small ruled calendar that works from the keyboard. The form posts the same fields the
// server action has always read: channel, followUpOn, note and, under an AI draft, aiDraftId. Saving
// renews your claim and moves a Not contacted company to Contacted; the server does both.

type FollowMode = "3" | "7" | "14" | "pick";
const FOLLOW_DAYS = { "3": 3, "7": 7, "14": 14 } as const;
// The server accepts a follow-up from today to a year out.
const MAX_DAYS = 365;

type Props = {
  workspaceId: string;
  companyId: string;
  action: (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;
  // Today in West Lafayette, from the database ("2026-10-25").
  today: string;
  // Logging a letter that came from an AI draft: the log records which draft it was, and the
  // channel is email.
  aiDraftId?: string;
  initialNote?: string;
  compact?: boolean;
  label?: string;
};

export function LogOutreachForm({ workspaceId, companyId, action, today, aiDraftId, initialNote = "", compact = false, label = "Log outreach" }: Props) {
  const id = useId();
  const followPick = useRef<HTMLInputElement | null>(null);
  const [channel, setChannel] = useState<Channel>("EMAIL");
  const [followMode, setFollowMode] = useState<FollowMode>("7");
  const [followPicked, setFollowPicked] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const defaultFollow = addDays(today, 7);
  const followUpOn = followMode === "pick" ? (followPicked ?? defaultFollow) : addDays(today, FOLLOW_DAYS[followMode]);

  // The Pick chip opens its calendar on a click or on Enter or Space. Moving onto it with the arrow
  // keys only selects it, so a person can pass through the group without a popup in the way.
  const pickHandlers = {
    onClick: (event: MouseEvent<HTMLInputElement>) => {
      if (event.detail > 0) {
        setFollowMode("pick");
        setFollowPicked((d) => d ?? defaultFollow);
        setOpen(true);
      }
    },
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setFollowMode("pick");
        setFollowPicked((d) => d ?? defaultFollow);
        setOpen(true);
      }
    },
  };

  const channelOptions: ChipOption<Channel>[] = CHANNELS.map((c) => ({ value: c, label: CHANNEL_LABELS[c] }));
  const followOptions: ChipOption<FollowMode>[] = [
    { value: "3", label: "3 days", ariaLabel: `In 3 days, ${formatYmd(addDays(today, 3))}` },
    { value: "7", label: "7 days", ariaLabel: `In 7 days, ${formatYmd(addDays(today, 7))}` },
    { value: "14", label: "14 days", ariaLabel: `In 14 days, ${formatYmd(addDays(today, 14))}` },
    {
      value: "pick",
      label: followMode === "pick" && followPicked ? formatYmd(followPicked) : "Pick",
      ariaLabel: followMode === "pick" && followPicked ? `Pick a day, ${formatYmd(followPicked)} chosen` : "Pick a day",
      inputRef: (el) => {
        followPick.current = el;
      },
      ...pickHandlers,
    },
  ];

  return (
    <ActionForm
      action={action}
      submitLabel={label}
      primary
      successMessage="Logged."
      className={`lg-logform ${compact ? "lg-logform-compact" : ""}`}
    >
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="followUpOn" value={followUpOn} />
      {aiDraftId && <input type="hidden" name="aiDraftId" value={aiDraftId} />}
      {aiDraftId ? <input type="hidden" name="channel" value="EMAIL" /> : <ChipGroup legend="Channel" name="channel" value={channel} options={channelOptions} onChange={setChannel} />}

      <div className="lg-logrow">
        <ChipGroup
          legend="Follow up in"
          name={`${id}-follow`}
          value={followMode}
          options={followOptions}
          onChange={(v) => {
            setFollowMode(v);
            if (v !== "pick") setOpen(false);
          }}
        />
        <p className="lg-hint lg-followon" aria-live="polite">
          Comes back to the queue on {formatYmd(followUpOn)}.
        </p>
        {open && (
          <CalendarPopover
            label="Pick the follow-up day"
            value={followUpOn}
            min={today}
            max={addDays(today, MAX_DAYS)}
            today={today}
            onPick={(ymd) => {
              setFollowPicked(ymd);
              setFollowMode("pick");
              setOpen(false);
              followPick.current?.focus();
            }}
            onClose={(restore) => {
              setOpen(false);
              if (restore) followPick.current?.focus();
            }}
          />
        )}
      </div>

      <div>
        <label className="lg-label" htmlFor={`${id}-note`}>
          Note
        </label>
        <textarea
          id={`${id}-note`}
          name="note"
          className="lg-textarea"
          rows={compact ? 2 : 3}
          maxLength={NOTE_MAX}
          placeholder="What you sent or talked about"
          defaultValue={initialNote}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
      </div>
    </ActionForm>
  );
}
