"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent } from "react";
import { addDaysYmd, formatYmd } from "@/demo/dates";
import { CHANNELS, CHANNEL_LABELS, type Channel } from "@/demo/types";
import { useCompany, useDemoActions } from "@/demo/store";
import { NOTE_MAX } from "@/demo/validation";
import { Tick } from "../marks";
import { useNotify } from "../providers";
import { ChipGroup, type ChipOption } from "./chips";
import { CalendarPopover } from "./date-popover";
import { LedgerMenu } from "./ledger-menu";
import { ErrorLine } from "./shared";

// The fast log form. Logging is about three clicks and a note: a channel chip, when it went out
// (Today, Yesterday or a picked day), and when to follow up (3, 7 or 14 days, or a picked day, with 7
// preselected). Every choice is a real radio input drawn as a chip, and "Pick" opens a small ruled
// calendar that works from the keyboard. Saving renews the claim and moves a Not contacted company to
// Contacted. The company page, the queue's side panel and focus mode all use this one component.

type DateMode = "today" | "yesterday" | "pick";
type FollowMode = "3" | "7" | "14" | "pick";
type Open = "date" | "follow" | null;

const FOLLOW_DAYS: Record<Exclude<FollowMode, "pick">, number> = { "3": 3, "7": 7, "14": 14 };

export function LogOutreachForm({
  ws,
  companyId,
  compact = false,
  onLogged,
  onCancel,
  autoFocus = false,
}: {
  ws: string;
  companyId: string;
  compact?: boolean;
  onLogged?: () => void;
  onCancel?: () => void;
  autoFocus?: boolean;
}) {
  const detail = useCompany(ws, companyId);
  const actions = useDemoActions();
  const notify = useNotify();
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const datePick = useRef<HTMLInputElement | null>(null);
  const followPick = useRef<HTMLInputElement | null>(null);
  const [channel, setChannel] = useState<Channel>("EMAIL");
  const [dateMode, setDateMode] = useState<DateMode>("today");
  const [datePicked, setDatePicked] = useState<string | null>(null);
  const [followMode, setFollowMode] = useState<FollowMode>("7");
  const [followPicked, setFollowPicked] = useState<string | null>(null);
  const [open, setOpen] = useState<Open>(null);
  const [note, setNote] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(0);

  useEffect(() => {
    if (autoFocus) form.current?.querySelector<HTMLInputElement>('input[type="radio"]:checked')?.focus();
  }, [autoFocus]);

  if (!detail) return null;
  const today = detail.today;
  const sentOn = dateMode === "today" ? today : dateMode === "yesterday" ? addDaysYmd(today, -1) : (datePicked ?? today);
  const followUpOn = followMode === "pick" ? (followPicked ?? detail.defaultFollowUpOn) : addDaysYmd(today, FOLLOW_DAYS[followMode]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const result = actions.logOutreach(ws, companyId, { channel, note, followUpOn, sentOn, templateId: templateId || null });
    if (!result.ok) {
      setError(result.error);
      setSaved(0);
      return;
    }
    setSaved((n) => n + 1);
    setNote("");
    notify("Logged.");
    onLogged?.();
  };

  // The Pick chip opens its calendar on a click or on Enter or Space. Moving onto it with the arrow
  // keys only selects it, so a person can pass through the group without a popup in the way.
  const pickHandlers = (which: Exclude<Open, null>, select: () => void) => ({
    onClick: (event: MouseEvent<HTMLInputElement>) => {
      if (event.detail > 0) {
        select();
        setOpen(which);
      }
    },
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        select();
        setOpen(which);
      }
    },
  });

  const channelOptions: ChipOption<Channel>[] = CHANNELS.map((c) => ({ value: c, label: CHANNEL_LABELS[c] }));
  const dateOptions: ChipOption<DateMode>[] = [
    { value: "today", label: "Today" },
    { value: "yesterday", label: "Yesterday" },
    {
      value: "pick",
      label: dateMode === "pick" && datePicked ? formatYmd(datePicked) : "Pick",
      ariaLabel: dateMode === "pick" && datePicked ? `Pick a day, ${formatYmd(datePicked)} chosen` : "Pick a day",
      inputRef: (el) => {
        datePick.current = el;
      },
      ...pickHandlers("date", () => {
        setDateMode("pick");
        setDatePicked((d) => d ?? today);
      }),
    },
  ];
  const followOptions: ChipOption<FollowMode>[] = [
    { value: "3", label: "3 days", ariaLabel: "In 3 days" },
    { value: "7", label: "7 days", ariaLabel: "In 7 days" },
    { value: "14", label: "14 days", ariaLabel: "In 14 days" },
    {
      value: "pick",
      label: followMode === "pick" && followPicked ? formatYmd(followPicked) : "Pick",
      ariaLabel: followMode === "pick" && followPicked ? `Pick a day, ${formatYmd(followPicked)} chosen` : "Pick a day",
      inputRef: (el) => {
        followPick.current = el;
      },
      ...pickHandlers("follow", () => {
        setFollowMode("pick");
        setFollowPicked((d) => d ?? detail.defaultFollowUpOn);
      }),
    },
  ];

  const templateOptions = [{ value: "", label: "None, written by hand" }, ...detail.templates.map((t) => ({ value: t.id, label: t.name }))];

  return (
    <form ref={form} noValidate onSubmit={submit} className={`lg-logform ${compact ? "lg-logform-compact" : ""}`} aria-label="Log outreach">
      <ChipGroup legend="Channel" value={channel} options={channelOptions} onChange={setChannel} />

      <div className="lg-logrow">
        <ChipGroup
          legend="Sent"
          value={dateMode}
          options={dateOptions}
          onChange={(v) => {
            setDateMode(v);
            if (v !== "pick") setOpen(null);
          }}
        />
        {open === "date" && (
          <CalendarPopover
            label="Pick the day you reached out"
            value={sentOn}
            min={addDaysYmd(today, -365)}
            max={today}
            today={today}
            onPick={(ymd) => {
              setDatePicked(ymd);
              setDateMode("pick");
              setOpen(null);
              datePick.current?.focus();
            }}
            onClose={(restore) => {
              setOpen(null);
              if (restore) datePick.current?.focus();
            }}
          />
        )}
      </div>

      <div className="lg-logrow">
        <ChipGroup
          legend="Follow up in"
          value={followMode}
          options={followOptions}
          onChange={(v) => {
            setFollowMode(v);
            if (v !== "pick") setOpen(null);
          }}
        />
        <p className="lg-hint lg-followon" aria-live="polite">
          Comes back to the queue on {formatYmd(followUpOn)}.
        </p>
        {open === "follow" && (
          <CalendarPopover
            label="Pick the follow-up day"
            value={followUpOn}
            min={today}
            max={detail.maxFollowUpOn}
            today={today}
            onPick={(ymd) => {
              setFollowPicked(ymd);
              setFollowMode("pick");
              setOpen(null);
              followPick.current?.focus();
            }}
            onClose={(restore) => {
              setOpen(null);
              if (restore) followPick.current?.focus();
            }}
          />
        )}
      </div>

      {!compact && detail.templates.length > 0 && (
        <div className="lg-logrow">
          <span className="lg-label">Template, if you used one</span>
          <LedgerMenu label="Template" value={templateId} options={templateOptions} onChange={setTemplateId} />
        </div>
      )}

      <div className="lg-lognote">
        <label className="lg-label" htmlFor={`${id}-note`}>
          Note
        </label>
        <textarea
          id={`${id}-note`}
          className="lg-textarea"
          rows={compact ? 2 : 3}
          maxLength={NOTE_MAX}
          placeholder="What you sent or talked about"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              form.current?.requestSubmit();
            }
          }}
        />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="submit" className="lg-btn lg-btn-primary">
          Log outreach
        </button>
        {onCancel && (
          <button type="button" className="lg-btn lg-btn-quiet" onClick={onCancel}>
            Cancel
          </button>
        )}
        {saved > 0 && !error && (
          <span className="lg-ok" role="status">
            <Tick key={saved} size={18} />
            Logged.
          </span>
        )}
      </div>
      <ErrorLine>{error}</ErrorLine>
    </form>
  );
}
