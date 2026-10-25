"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import type { SaveResult } from "@/lib/companies";
import { COMPANY_LIMITS, type ActionResult } from "@/lib/validation";

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

const EMPTY: CompanyValues = { name: "", industry: "", website: "", notes: "" };
const LABELS: Record<keyof CompanyValues, string> = { name: "Name", industry: "Industry", website: "Website", notes: "Notes" };

// What the server stored for a submitted form (each box trimmed), so the form's "original" values
// match the database exactly after a save.
const stored = (form: FormData): CompanyValues => {
  const text = (field: keyof CompanyValues) => String(form.get(field) ?? "").trim();
  return { name: text("name"), industry: text("industry"), website: text("website"), notes: text("notes") };
};

// Add and edit form for a company. The boxes are controlled (kept in React state) so nothing
// typed is lost when the server stops to ask about look-alikes or reports a conflict.
export function CompanyForm(props: Props) {
  const initial = props.mode === "edit" ? props.initial : EMPTY;
  const [values, setValues] = useState(initial);
  // The values this form was based on, sent with every edit so the server can tell whether
  // someone else changed a field in the meantime.
  const [original, setOriginal] = useState(initial);

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
  const runFromDialog = (action: Action<undefined>) => async (form: FormData) => {
    setDialogError(null);
    const outcome = await action(null, form);
    if (outcome && !outcome.ok) setDialogError(outcome.error);
  };

  const set = (field: keyof CompanyValues) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [field]: e.target.value }));
  const result = state?.ok ? state.data : null;

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="workspaceId" value={props.workspaceId} />
      {props.mode === "edit" && (
        <>
          <input type="hidden" name="companyId" value={props.companyId} />
          {(Object.keys(original) as (keyof CompanyValues)[]).map((field) => (
            <input key={field} type="hidden" name={`original.${field}`} value={original[field]} />
          ))}
        </>
      )}

      <label className="flex flex-col gap-1">
        <span>Name</span>
        <input name="name" required maxLength={COMPANY_LIMITS.name} value={values.name} onChange={set("name")} className="rounded border px-2 py-1" />
      </label>
      <label className="flex flex-col gap-1">
        <span>Industry</span>
        <input
          name="industry"
          list="industries"
          maxLength={COMPANY_LIMITS.industry}
          value={values.industry}
          onChange={set("industry")}
          className="rounded border px-2 py-1"
        />
        <datalist id="industries">
          {props.industries.map((industry) => (
            <option key={industry} value={industry} />
          ))}
        </datalist>
      </label>
      <label className="flex flex-col gap-1">
        <span>Website</span>
        <input
          name="website"
          inputMode="url"
          placeholder="acme.com"
          maxLength={COMPANY_LIMITS.website}
          value={values.website}
          onChange={set("website")}
          className="rounded border px-2 py-1"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span>Notes</span>
        <textarea name="notes" rows={4} maxLength={COMPANY_LIMITS.notes} value={values.notes} onChange={set("notes")} className="rounded border px-2 py-1" />
      </label>

      {result?.status === "possible-duplicates" && (
        <div role="alert" className="flex flex-col gap-2 rounded border border-amber-500 bg-amber-50 p-3 text-sm text-zinc-900">
          <p className="font-semibold">This looks like a company already in the workspace:</p>
          <ul className="flex flex-col gap-2">
            {result.matches.map((match) => (
              <li key={match.id} className="flex flex-wrap items-center gap-2">
                <Link href={`/${props.workspaceId}/companies/${match.id}`} className="underline">
                  {match.name}
                </Link>
                {match.website && <span className="text-zinc-600">{match.website}</span>}
                <span className="text-zinc-600">(same {match.matchedOn.join(" and ")})</span>
                {match.archived && <span className="rounded bg-zinc-200 px-1">archived</span>}
                {props.mode === "create" && match.archived && (
                  <button
                    formAction={runFromDialog(props.unarchive)}
                    name="companyId"
                    value={match.id}
                    className="rounded border px-2 py-0.5"
                  >
                    Same company: unarchive it instead
                  </button>
                )}
                {props.mode === "create" && !match.archived && (
                  <Link href={`/${props.workspaceId}/companies/${match.id}`} className="rounded border px-2 py-0.5">
                    Same company: open it
                  </Link>
                )}
                {props.mode === "edit" && !match.archived && (
                  <button
                    formAction={runFromDialog(props.archiveAsDuplicate)}
                    name="keepId"
                    value={match.id}
                    className="rounded border px-2 py-0.5"
                  >
                    Same company: archive this one
                  </button>
                )}
              </li>
            ))}
          </ul>
          {dialogError && <p className="text-red-600">{dialogError}</p>}
          <div>
            <button
              type="submit"
              name="separateFrom"
              value={result.matches.map((m) => m.id).join(",")}
              disabled={pending}
              className="rounded border px-3 py-1"
            >
              Separate entries: save anyway
            </button>
          </div>
        </div>
      )}

      {result?.status === "conflict" && (
        <div role="alert" className="flex flex-col gap-2 rounded border border-amber-500 bg-amber-50 p-3 text-sm text-zinc-900">
          <p className="font-semibold">Someone else changed this company while you were editing. Nothing was saved.</p>
          <ul className="flex flex-col gap-2">
            {result.conflicts.map((c) => (
              <li key={c.field} className="flex flex-wrap items-center gap-2">
                <span>
                  {LABELS[c.field]} is now <q>{c.theirs ?? "(empty)"}</q>. Your version is still in the box.
                </span>
                <button
                  type="button"
                  onClick={() => setValues((v) => ({ ...v, [c.field]: c.theirs ?? "" }))}
                  className="rounded border px-2 py-0.5"
                >
                  Use theirs
                </button>
              </li>
            ))}
          </ul>
          <p>Save again to replace theirs with yours.</p>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="rounded border px-3 py-1 disabled:opacity-50">
          {pending ? "Saving..." : props.mode === "create" ? "Add company" : "Save changes"}
        </button>
        {state && !state.ok && (
          <p role="alert" className="text-sm text-red-600">
            {state.error}
          </p>
        )}
        {result?.status === "saved" && <p className="text-sm text-green-700">Saved.</p>}
      </div>
    </form>
  );
}
