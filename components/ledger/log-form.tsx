"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { ActionForm, useActionFormPending } from "@/components/action-form";
import { CHANNEL_LABELS, CHANNELS } from "@/lib/channels";
import { addDays, formatYmd } from "@/lib/dates";
import { NOTE_MAX } from "@/lib/limits";
import type { TemplateOption } from "@/lib/templates";
import type { ActionResult } from "@/lib/validation";
import type { Channel } from "@/generated/prisma/enums";
import { ChipGroup, type ChipOption } from "./chips";
import { CopyLinkIcon } from "./icons";
import { CalendarPopover } from "./date-popover";
import { Disclosure } from "./disclosure";
import { whenDrawn } from "./focus";
import { completeStamp } from "./motion-kit";
import { ExperimentLine, experimentRunning } from "./lab/experiment-line";
import "./company.css";
import "./templates.css";

// The fast log form. Logging is a channel chip, when to follow up (3, 7 or 14 days, or a picked day,
// with 7 preselected) and a note. Every choice is a real radio input drawn as a chip, and "Pick"
// opens a small ruled calendar that works from the keyboard. The form posts the same fields the
// server action has always read: channel, followUpOn, note and, under an AI draft, aiDraftId. Saving
// renews your claim and moves a Not contacted company to Contacted; the server does both. When the
// workspace has templates, a picker records which one the email was based on (templateId) and shows
// its text to copy. Under an AI draft there is no picker: that email is credited to the draft.
//
// Each entry carries a key (clientKey, a UUID made in the browser and renewed after every save), so
// a double press, a retry or a second tab logs it once: the server keeps the first and answers ok to
// the rest (lib/claims.ts). Ctrl/Cmd+Enter in the note does nothing while a save is in flight.

type FollowMode = "3" | "7" | "14" | "pick";
const FOLLOW_DAYS = { "3": 3, "7": 7, "14": 14 } as const;
// The server accepts a follow-up from today to a year out.
const MAX_DAYS = 365;

// A fresh key for the next entry. randomUUID needs a secure context (https or localhost); the
// fallback builds the same version 4 shape from getRandomValues.
function newKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

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
  // The workspace's templates that are not archived, as the company page loads them (getCompanyPage in lib/companies.ts).
  templates?: TemplateOption[];
  // The finish moment. After a save the Log button is stamped. `settleInto` (a selector for the
  // list the new entry is drawn in, e.g. "#outreach .lg-entries") stamps that entry too once the
  // fresh render brings it, so the eye follows the entry into the log. `onLogged` runs before the
  // fresh render is committed and is awaited: the queue uses it to send its row away first.
  settleInto?: string;
  onLogged?: () => Promise<void> | void;
};

export function LogOutreachForm({ workspaceId, companyId, action, today, aiDraftId, initialNote = "", compact = false, label = "Log outreach", templates = [], settleInto, onLogged }: Props) {
  const id = useId();
  const wrap = useRef<HTMLDivElement>(null);
  // The server action, with the finish moment around it. Nothing waits on the stamp: it plays while
  // the fresh page arrives. Only onLogged (a row leaving) is awaited, and it always resolves.
  const logAndStamp = useCallback(
    async (prev: ActionResult | null, form: FormData): Promise<ActionResult> => {
      const seen = settleInto ? new Set(Array.from(document.querySelectorAll<HTMLElement>(`${settleInto} [data-entry-id]`), (el) => el.dataset.entryId)) : null;
      const result = await action(prev, form);
      if (!result.ok) return result;
      void completeStamp(wrap.current?.querySelector('button[type="submit"]'));
      if (seen && settleInto) {
        // The new entry, once the fresh render draws it at the top of the list, settles in with the
        // same stamp, a beat after the button's.
        whenDrawn(
          () => Array.from(document.querySelectorAll<HTMLElement>(`${settleInto} [data-entry-id]`)).find((el) => !seen.has(el.dataset.entryId)),
          (entry) => void completeStamp(entry),
        );
      }
      if (onLogged) await onLogged();
      else {
        // The button was disabled while saving, which drops focus to <body>: give it back once it
        // is enabled again, unless the person has moved on.
        whenDrawn(
          () => {
            const button = wrap.current?.querySelector<HTMLButtonElement>('button[type="submit"]');
            return button && !button.disabled ? button : null;
          },
          (button) => {
            if (!document.activeElement || document.activeElement === document.body) button.focus({ preventScroll: true });
          },
        );
      }
      return result;
    },
    [action, settleInto, onLogged],
  );
  const followPick = useRef<HTMLInputElement | null>(null);
  const [channel, setChannel] = useState<Channel>("EMAIL");
  const [followMode, setFollowMode] = useState<FollowMode>("7");
  const [followPicked, setFollowPicked] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  // Bumped after each successful log, so the template picker starts again at "No template". It is
  // controlled state that React's form reset doesn't clear, and a template left selected would
  // quietly credit the next outreach (a call, a LinkedIn message) to it.
  const [logged, setLogged] = useState(0);
  // Made on the first touch of the form (so the server render and the browser agree on an empty
  // value), then renewed after each save. The form posts whatever is in the box at submit time, so
  // two quick submits carry the same key even though the first one's success renews it.
  const [clientKey, setClientKey] = useState("");
  const ensureKey = () => {
    if (!clientKey) setClientKey(newKey());
  };

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
    <div ref={wrap} className="lg-logwrap" onFocusCapture={ensureKey} onPointerDownCapture={ensureKey}>
      <ActionForm
        action={logAndStamp}
        submitLabel={label}
        primary
        successMessage="Logged."
        onSuccess={() => {
          setLogged((n) => n + 1);
          setClientKey(newKey());
        }}
        className={`lg-logform ${compact ? "lg-logform-compact" : ""}`}
      >
        <input type="hidden" name="workspaceId" value={workspaceId} />
        <input type="hidden" name="companyId" value={companyId} />
        <input type="hidden" name="followUpOn" value={followUpOn} />
        {clientKey && <input type="hidden" name="clientKey" value={clientKey} />}
        {aiDraftId && <input type="hidden" name="aiDraftId" value={aiDraftId} />}
        {aiDraftId ? <input type="hidden" name="channel" value="EMAIL" /> : <ChipGroup legend="Channel" name="channel" value={channel} options={channelOptions} onChange={setChannel} />}

        <div className="lg-logrow" data-tour="log-followup">
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

        <NoteBox id={`${id}-note`} rows={compact ? 2 : 3} initialNote={initialNote} />
        {!aiDraftId && templates.length > 0 && (
          <Disclosure summary="Based on a template?" count={experimentRunning(templates) ? "Experiment running" : undefined} variant="inline" className="lg-tpldisc">
            <TemplatePicker key={logged} id={`${id}-tpl`} templates={templates} />
          </Disclosure>
        )}
      </ActionForm>
    </div>
  );
}

// The note, with Ctrl/Cmd+Enter to save. The shortcut is refused while a save is in flight (the
// button is disabled then, but requestSubmit() would not care), and between the press and the
// moment the form reports pending, so pressing it twice quickly saves once.
function NoteBox({ id, rows, initialNote }: { id: string; rows: number; initialNote: string }) {
  const pending = useActionFormPending();
  const sent = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!pending) sent.current = false;
  }, [pending]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <div>
      <label className="lg-label" htmlFor={id}>
        Note
      </label>
      <textarea
        id={id}
        name="note"
        className="lg-textarea"
        rows={rows}
        maxLength={NOTE_MAX}
        placeholder="What you sent or talked about"
        defaultValue={initialNote}
        aria-keyshortcuts="Control+Enter Meta+Enter"
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            if (pending || sent.current) return;
            sent.current = true;
            // If no save starts (the browser refused the form), the shortcut works again shortly.
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => {
              timer.current = null;
              sent.current = false;
            }, 3000);
            event.currentTarget.form?.requestSubmit();
          }
        }}
      />
    </div>
  );
}

// "Based on a template": a select of the workspace's templates and, once one is picked, its text with
// a Copy button, for pasting into your own mail. The placeholders are left for you to fill in there.
function TemplatePicker({ id, templates }: { id: string; templates: TemplateOption[] }) {
  const [templateId, setTemplateId] = useState("");
  const [copied, setCopied] = useState("");
  const chosen = templates.find((t) => t.id === templateId);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("Copied the template.");
    } catch {
      setCopied("Could not copy. Select the text and copy it yourself.");
    }
  };

  return (
    <div className="lg-tplpick">
      <label className="lg-label" htmlFor={id}>
        Template
      </label>
      <select
        id={id}
        name="templateId"
        className="lg-select"
        value={templateId}
        onChange={(event) => {
          setTemplateId(event.target.value);
          setCopied("");
        }}
      >
        <option value="">No template</option>
        {templates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <ExperimentLine
        templates={templates}
        selectedId={templateId}
        onUse={(pick) => {
          setTemplateId(pick);
          setCopied("");
        }}
      />
      {chosen && (
        <div className="lg-tplshow">
          <p className="lg-tpltext" aria-label={`Text of ${chosen.name}`}>
            {chosen.body}
          </p>
          <div className="lg-tplshow-acts">
            <button type="button" className="lg-btn lg-btn-sm" onClick={() => copy(chosen.body)}>
              <CopyLinkIcon size={16} />
              Copy text
            </button>
            <p className="lg-hint" role="status">
              {copied || "Fill in {{firstName}}, {{senderName}} and {{orgName}} in your mail before sending."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
