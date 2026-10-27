"use client";

import { useId, useState, type FormEvent } from "react";
import { CHANNELS, CHANNEL_LABELS, type Channel } from "@/demo/types";
import { useCompany, useDemoActions } from "@/demo/store";
import { NOTE_MAX } from "@/demo/validation";
import { Tick } from "../marks";
import { useNotify } from "../providers";
import { ErrorLine } from "./shared";

// The Log outreach form: channel, a follow-up date (seven days out by default, never earlier than
// today or later than a year), and a note. Saving renews the claim and moves a Not contacted company
// to Contacted. On the company page it is the form behind the queue's "Log outreach" link; the
// queue also opens it right under a row so the whole follow-up can be done in place.
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
  const [channel, setChannel] = useState<Channel>("EMAIL");
  const [followUpOn, setFollowUpOn] = useState(detail?.defaultFollowUpOn ?? "");
  const [note, setNote] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(0);

  if (!detail) return null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const result = actions.logOutreach(ws, companyId, { channel, note, followUpOn, templateId: templateId || null });
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

  return (
    <form onSubmit={submit} className={`lg-logform ${compact ? "lg-logform-compact" : ""}`} aria-label="Log outreach">
      <div className="lg-logform-grid">
        <div>
          <label className="lg-label" htmlFor={`${id}-channel`}>
            Channel
          </label>
          <select id={`${id}-channel`} className="lg-select" value={channel} onChange={(e) => setChannel(e.target.value as Channel)} autoFocus={autoFocus}>
            {CHANNELS.map((c) => (
              <option key={c} value={c}>
                {CHANNEL_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="lg-label" htmlFor={`${id}-follow`}>
            Follow up on
          </label>
          <input
            id={`${id}-follow`}
            type="date"
            className="lg-input lg-num"
            value={followUpOn}
            min={detail.today}
            max={detail.maxFollowUpOn}
            onChange={(e) => setFollowUpOn(e.target.value)}
            required
          />
        </div>
        {!compact && detail.templates.length > 0 && (
          <div>
            <label className="lg-label" htmlFor={`${id}-tpl`}>
              Template, if you used one
            </label>
            <select id={`${id}-tpl`} className="lg-select" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              <option value="">None, written by hand</option>
              {detail.templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div className="mt-3">
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
