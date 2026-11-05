"use client";

import { useId, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import "@/components/ledger/zod-jitless";
import { ActionForm } from "@/components/action-form";
import { CHANNEL_LABELS, CHANNELS } from "@/lib/channels";
import { addDays } from "@/lib/dates";
import type { TemplateOption } from "@/lib/templates";
import { NOTE_MAX, type ActionResult } from "@/lib/validation";
import type { Channel } from "@/generated/prisma/enums";
import { ChipGroup, type ChipOption } from "./chips";
import { CopyLinkIcon } from "./icons";
import { CalendarPopover } from "./date-popover";
import { formatYmd } from "./ymd";
import "./company.css";
import "./templates.css";

// The fast log form. Logging is a channel chip, when to follow up (3, 7 or 14 days, or a picked day,
// with 7 preselected) and a note. Every choice is a real radio input drawn as a chip, and "Pick"
// opens a small ruled calendar that works from the keyboard. The form posts the same fields the
// server action has always read: channel, followUpOn, note and, under an AI draft, aiDraftId. Saving
// renews your claim and moves a Not contacted company to Contacted; the server does both. When the
// workspace has templates, a picker records which one the email was based on (templateId) and shows
// its text to copy. Under an AI draft there is no picker: that email is credited to the draft.

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
  // The workspace's templates that are not archived (lib/templates.ts activeTemplates).
  templates?: TemplateOption[];
};

export function LogOutreachForm({ workspaceId, companyId, action, today, aiDraftId, initialNote = "", compact = false, label = "Log outreach", templates = [] }: Props) {
  const id = useId();
  const followPick = useRef<HTMLInputElement | null>(null);
  const [channel, setChannel] = useState<Channel>("EMAIL");
  const [followMode, setFollowMode] = useState<FollowMode>("7");
  const [followPicked, setFollowPicked] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  // Bumped after each successful log, so the template picker starts again at "No template". It is
  // controlled state that React's form reset doesn't clear, and a template left selected would
  // quietly credit the next outreach (a call, a LinkedIn message) to it.
  const [logged, setLogged] = useState(0);

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
      onSuccess={() => setLogged((n) => n + 1)}
      className={`lg-logform ${compact ? "lg-logform-compact" : ""}`}
    >
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="followUpOn" value={followUpOn} />
      {aiDraftId && <input type="hidden" name="aiDraftId" value={aiDraftId} />}
      {aiDraftId ? <input type="hidden" name="channel" value="EMAIL" /> : <ChipGroup legend="Channel" name="channel" value={channel} options={channelOptions} onChange={setChannel} />}
      {!aiDraftId && templates.length > 0 && <TemplatePicker key={logged} id={`${id}-tpl`} templates={templates} />}

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
