"use client";

import Link from "next/link";
import { createContext, useActionState, useContext, useEffect, useId, useState } from "react";
import "@/components/ledger/zod-jitless";
import { LazyDisclosure } from "@/components/ledger/disclosure";
import { DuplicateIcon, WarningIcon } from "@/components/ledger/icons";
import { IndustryField } from "@/components/ledger/industry-field";
import { Tick } from "@/components/ledger/marks";
import { useNotify } from "@/components/ledger/providers";
import { ErrorLine } from "@/components/ledger/shared";
import type { SaveResult } from "@/lib/companies";
import { COMPANY_LIMITS, type ActionResult } from "@/lib/validation";
import "@/components/ledger/company.css";

export type CompanyValues = { name: string; industry: string; website: string; notes: string };

type Action<T> = (prev: ActionResult<T> | null, form: FormData) => Promise<ActionResult<T>>;

type Props = {
  workspaceId: string;
  industries: string[];
  save: Action<SaveResult>;
  // "Unarchive it instead" for an archived look-alike, when adding a company.
  unarchive: Action<undefined>;
} & (
  | { mode: "create" }
  // "Same company: archive this one", when an edit makes this company look like another.
  | { mode: "edit"; companyId: string; initial: CompanyValues; archiveAsDuplicate: Action<undefined> }
);

// Set by the company header while Edit details is open in place: close(true) after a save, close(false) on Cancel.
export const EditDetailsContext = createContext<{ close: (saved: boolean) => void } | null>(null);
const useEditDetails = () => useContext(EditDetailsContext);

const EMPTY: CompanyValues = { name: "", industry: "", website: "", notes: "" };
const LABELS: Record<keyof CompanyValues, string> = { name: "Name", industry: "Industry", website: "Website", notes: "Notes" };

// What the server stored for a submitted form (each box trimmed), so the form's "original" values
// match the database exactly after a save.
const stored = (form: FormData): CompanyValues => {
  const text = (field: keyof CompanyValues) => String(form.get(field) ?? "").trim();
  return { name: text("name"), industry: text("industry"), website: text("website"), notes: text("notes") };
};

const reason = (matchedOn: ("name" | "website")[]) => (matchedOn.length === 2 ? "same name and website" : `same ${matchedOn[0]}`);

// Add and edit form for a company. The boxes are controlled (kept in React state) so nothing
// typed is lost when the server stops to ask about look-alikes or reports a conflict. Adding: name,
// website and industry, with notes one click away. Editing: opened in place from the company
// header's ⋯ menu, with Cancel; it closes itself after a save.
export function CompanyForm(props: Props) {
  const editor = useEditDetails();
  const initial = props.mode === "edit" ? props.initial : EMPTY;
  const [values, setValues] = useState(initial);
  // The values this form was based on, sent with every edit so the server can tell whether
  // someone else changed a field in the meantime.
  const [original, setOriginal] = useState(initial);
  const notify = useNotify();
  const id = useId();

  const [state, formAction, pending] = useActionState<ActionResult<SaveResult> | null, FormData>(async (prev, form) => {
    const result = await props.save(prev, form);
    if (result.ok && result.data.status === "conflict") {
      // Base the next save on what's there now, so saving again is a deliberate replace.
      const theirs = Object.fromEntries(result.data.conflicts.map((c) => [c.field, c.theirs ?? ""]));
      setOriginal((o) => ({ ...o, ...theirs }));
    }
    if (result.ok && result.data.status === "saved") {
      const now = stored(form);
      setValues(now);
      setOriginal(now);
    }
    return result;
  }, null);

  // The dialog's "Same company" buttons run their own action. On success it opens another page;
  // on failure (say someone else already unarchived it) the reason shows in the dialog.
  const [dialogError, setDialogError] = useState<string | null>(null);
  // React doesn't send a button's name and value when its formAction is a function, so the id
  // the action needs is added to the form here.
  const runFromDialog = (action: Action<undefined>, field: string, id: string) => async (form: FormData) => {
    setDialogError(null);
    form.set(field, id);
    const outcome = await action(null, form);
    if (outcome && !outcome.ok) setDialogError(outcome.error);
  };

  const result = state?.ok ? state.data : null;
  useEffect(() => {
    if (result?.status === "saved" && props.mode === "edit") {
      notify("Saved.");
      editor?.close(true);
    }
  }, [result, props.mode, notify, editor]);

  const set = (field: keyof CompanyValues) => (value: string) => setValues((v) => ({ ...v, [field]: value }));

  return (
    <form action={formAction} className={props.mode === "create" ? "lg-newform" : "lg-detailsform"} aria-label={props.mode === "create" ? "Add a company" : "Company details"}>
      <input type="hidden" name="workspaceId" value={props.workspaceId} />
      {props.mode === "edit" && (
        <>
          <input type="hidden" name="companyId" value={props.companyId} />
          {(Object.keys(original) as (keyof CompanyValues)[]).map((field) => (
            <input key={field} type="hidden" name={`original.${field}`} value={original[field]} />
          ))}
        </>
      )}

      <div>
        <label className="lg-label" htmlFor={`${id}-name`}>
          Name
        </label>
        <input
          id={`${id}-name`}
          name="name"
          className="lg-input"
          required
          maxLength={COMPANY_LIMITS.name}
          value={values.name}
          onChange={(e) => set("name")(e.target.value)}
          autoFocus={props.mode === "create"}
        />
      </div>
      <div className="lg-row2">
        <div>
          <label className="lg-label" htmlFor={`${id}-website`}>
            Website
          </label>
          <input
            id={`${id}-website`}
            name="website"
            className="lg-input"
            inputMode="url"
            placeholder="example.com"
            maxLength={COMPANY_LIMITS.website}
            value={values.website}
            onChange={(e) => set("website")(e.target.value)}
          />
        </div>
        <IndustryField value={values.industry} onChange={set("industry")} suggestions={props.industries} maxLength={COMPANY_LIMITS.industry} />
      </div>
      {props.mode === "create" ? (
        <LazyDisclosure summary="Add notes" variant="inline" className="lg-notesdisc">
          <NotesBox id={id} value={values.notes} onChange={set("notes")} />
        </LazyDisclosure>
      ) : (
        <NotesBox id={id} value={values.notes} onChange={set("notes")} />
      )}

      {result?.status === "possible-duplicates" && (
        <div role="alert" className="lg-warn-box">
          <p className="lg-warn-title">
            <DuplicateIcon size={18} />
            This looks like a company already in the workspace:
          </p>
          <ul className="lg-matches">
            {result.matches.map((match) => (
              <li key={match.id}>
                <Link href={`/${props.workspaceId}/companies/${match.id}`} className="lg-link font-semibold">
                  {match.name}
                </Link>
                {match.website && <span className="lg-muted">, {match.website}</span>}
                <span className="lg-muted"> ({reason(match.matchedOn)})</span>
                {match.archived && <span className="lg-badge lg-badge-stale ml-2">archived</span>}
                <div className="lg-matchacts">
                  {props.mode === "create" && match.archived && (
                    <button type="submit" className="lg-btn lg-btn-sm" formAction={runFromDialog(props.unarchive, "companyId", match.id)}>
                      Same company: unarchive it instead
                    </button>
                  )}
                  {props.mode === "create" && !match.archived && (
                    <Link href={`/${props.workspaceId}/companies/${match.id}`} className="lg-btn lg-btn-sm">
                      Same company: open it
                    </Link>
                  )}
                  {props.mode === "edit" && !match.archived && (
                    <button type="submit" className="lg-btn lg-btn-sm" formAction={runFromDialog(props.archiveAsDuplicate, "keepId", match.id)}>
                      Same company: archive this one
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {result.total > result.matches.length && (
            <p className="lg-muted mt-2">
              And {(result.total - result.matches.length).toLocaleString("en-US")} more with the same name or website.
            </p>
          )}
          <ErrorLine>{dialogError}</ErrorLine>
          <div className="mt-3">
            <button type="submit" name="separateFrom" value={result.matches.map((m) => m.id).join(",")} disabled={pending} className="lg-btn">
              Separate entries: save anyway
            </button>
          </div>
        </div>
      )}

      {result?.status === "conflict" && (
        <div role="alert" className="lg-warn-box">
          <p className="lg-warn-title">
            <WarningIcon size={18} />
            Someone else changed this company while you were editing. Nothing was saved.
          </p>
          <ul className="lg-matches">
            {result.conflicts.map((c) => (
              <li key={c.field}>
                <span>
                  {LABELS[c.field]} is now <q>{c.theirs ?? "(empty)"}</q>. Your version is still in the box.
                </span>
                <div className="lg-matchacts">
                  <button type="button" onClick={() => set(c.field)(c.theirs ?? "")} className="lg-btn lg-btn-sm">
                    Use theirs
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-2">Save again to replace theirs with yours.</p>
        </div>
      )}

      <div className="lg-actions">
        <button type="submit" disabled={pending} className="lg-btn lg-btn-primary">
          {pending ? "Saving..." : props.mode === "create" ? "Add company" : "Save changes"}
        </button>
        {props.mode === "edit" && editor && (
          <button type="button" className="lg-btn" onClick={() => editor.close(false)}>
            Cancel
          </button>
        )}
        {result?.status === "saved" && props.mode === "edit" && !editor && (
          <span className="lg-ok" role="status">
            <Tick size={18} />
            Saved.
          </span>
        )}
      </div>
      {state && !state.ok && <ErrorLine>{state.error}</ErrorLine>}
    </form>
  );
}

function NotesBox({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  return (
    <div>
      <label className="lg-label" htmlFor={`${id}-notes`}>
        Notes
      </label>
      <textarea
        id={`${id}-notes`}
        name="notes"
        className="lg-textarea"
        rows={4}
        maxLength={COMPANY_LIMITS.notes}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
