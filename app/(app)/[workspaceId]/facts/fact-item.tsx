"use client";

import { useEffect, useState } from "react";
import { ActionForm } from "@/components/action-form";
import { Disclosure } from "@/components/ledger/disclosure";
import { focusSoon } from "@/components/ledger/focus";
import { CheckIcon, WarningIcon } from "@/components/ledger/icons";
import { OverflowMenu, type OverflowItem } from "@/components/ledger/overflow-menu";
import { useNotify } from "@/components/ledger/providers";
import { FACT_MAX, type ActionResult } from "@/lib/validation";

// One fact on the owner's fact sheet (facts/page.tsx): the text, a quote-check icon, one visible
// action in the right-hand slot, and a ⋯ menu for the rest. Verify is the action when the quote
// was found on its page (or the fact was written by hand); when it wasn't, Edit is, and "Verify
// anyway" waits in the menu. The quote sits behind "Show source".

type Action<T = undefined> = (prev: ActionResult<T> | null, form: FormData) => Promise<ActionResult<T>>;

export type FactView = {
  id: string;
  text: string;
  fromPdf: boolean;
  quote: string | null;
  pageNumber: number | null;
  fileName: string | null;
  quoteFound: boolean;
  verified: boolean;
  verifiedLine: string | null;
  stale: boolean;
  masked: boolean;
};

// A fact just saved that may come back in the other list (a new mount): it takes focus there.
let focusOnMount: string | null = null;

const MASKED_REASON = "It holds [email] or [phone]. Edit it first.";
export const factDomId = (id: string) => `fact-${id}`;

export function FactItem({
  workspaceId,
  fact,
  nextId,
  setVerified,
  remove,
  update,
}: {
  workspaceId: string;
  fact: FactView;
  // The fact after this one in its list (or before it, for the last), where focus goes when this
  // one leaves the list.
  nextId: string | null;
  setVerified: Action;
  remove: Action;
  update: Action<{ verified: boolean }>;
}) {
  const notify = useNotify();
  const [editing, setEditing] = useState(false);
  const domId = factDomId(fact.id);
  useEffect(() => {
    if (focusOnMount !== fact.id) return;
    focusOnMount = null;
    focusSoon(`#${domId}`);
  }, [fact.id, domId]);
  const fields = { workspaceId, factId: fact.id };
  const short = fact.text.length > 48 ? `${fact.text.slice(0, 47)}…` : fact.text;
  const afterLeave = nextId ? `#${factDomId(nextId)}` : ".lg-page-facts .lg-h1";
  const canVerify = !fact.masked && (!fact.fromPdf || fact.quoteFound);

  const openEditor = () => {
    setEditing(true);
    focusSoon(`#${domId}-edit`);
  };
  const edit: OverflowItem = { key: "edit", label: "Edit", onSelect: openEditor };
  const del: OverflowItem = {
    key: "delete",
    label: "Delete",
    danger: true,
    action: remove,
    fields,
    confirmMessage: "Delete this fact?",
    successMessage: "Fact deleted.",
    focusAfter: afterLeave,
  };
  const items: OverflowItem[] = fact.verified
    ? [
        edit,
        { key: "unverify", label: "Unverify", hint: "Drafts stop using it", action: setVerified, fields: { ...fields, verified: "0" }, successMessage: "Fact unverified.", focusAfter: afterLeave },
        del,
      ]
    : canVerify
      ? [edit, del]
      : [
          {
            key: "anyway",
            label: "Verify anyway",
            hint: fact.masked ? undefined : "You checked the packet yourself",
            disabled: fact.masked,
            disabledReason: MASKED_REASON,
            action: setVerified,
            fields: { ...fields, verified: "1" },
            successMessage: "Fact verified.",
            focusAfter: afterLeave,
          },
          del,
        ];

  // Saving an edit verifies it only while its quote still supports it (lib/facts.ts updateFact).
  const save: Action = async (_prev, form) => {
    const result = await update(null, form);
    if (!result.ok) return result;
    notify(result.data.verified ? "Fact saved." : "Saved, not verified: the quote no longer supports this. Verify anyway or add it as a hand-written fact.");
    setEditing(false);
    // The fact may move to the other list with the fresh render: focus finds it there.
    focusOnMount = fact.id;
    window.setTimeout(() => {
      if (focusOnMount === fact.id) focusOnMount = null;
    }, 3000);
    focusSoon(`#${domId}`);
    return { ok: true, data: undefined };
  };

  const check = fact.fromPdf ? (
    <span className={`lg-factcheck ${fact.quoteFound ? "lg-ok" : "lg-late"}`} title={fact.quoteFound ? "Quote found on that page" : "Quote not found on that page"}>
      {fact.quoteFound ? <CheckIcon size={16} /> : <WarningIcon size={16} />}
      <span className={fact.quoteFound || fact.verified ? "lg-sr" : "lg-factcheck-word"}>{fact.quoteFound ? "Quote found" : "Quote not found"}</span>
    </span>
  ) : null;

  return (
    <li id={domId} className="lg-fact" tabIndex={-1}>
      <div className="lg-fact-row">
        <p className="lg-facttext">
          {check}
          <span>{fact.text}</span>
          {fact.stale && <span className="lg-badge lg-badge-stale ml-2">Over a year old</span>}
        </p>
        <div className="lg-fact-acts">
          {!fact.verified && !editing &&
            (canVerify ? (
              <ActionForm
                action={setVerified}
                submitLabel="Verify"
                submitAriaLabel={`Verify: ${short}`}
                successMessage="Fact verified."
                primary
                small
                className="lg-fact-form"
                focusAfter={afterLeave}
              >
                <input type="hidden" name="workspaceId" value={workspaceId} />
                <input type="hidden" name="factId" value={fact.id} />
                <input type="hidden" name="verified" value="1" />
              </ActionForm>
            ) : (
              <button type="button" className="lg-btn lg-btn-sm lg-btn-primary" aria-label={`Edit: ${short}`} onClick={openEditor}>
                Edit
              </button>
            ))}
          <OverflowMenu label={`More actions for: ${short}`} items={items} />
        </div>
      </div>
      {editing && (
        <ActionForm action={save} submitLabel="Save fact" className="lg-editform" small>
          <input type="hidden" name="workspaceId" value={workspaceId} />
          <input type="hidden" name="factId" value={fact.id} />
          <label className="lg-label" htmlFor={`${domId}-edit`}>
            Fact
          </label>
          <textarea id={`${domId}-edit`} name="text" required maxLength={FACT_MAX} rows={2} defaultValue={fact.text} className="lg-textarea" />
          <button
            type="button"
            className="lg-linkbtn"
            onClick={() => {
              setEditing(false);
              focusSoon(`#${domId}`);
            }}
          >
            Cancel
          </button>
        </ActionForm>
      )}
      <FactSource fact={fact} owner />
    </li>
  );
}

// "Show source (page 2)": the quote the fact came from, and, for the owner, whether it was found
// there and who verified it. Shared with the officer's read-only list.
export function FactSource({ fact, owner = false }: { fact: FactView; owner?: boolean }) {
  if (!fact.fromPdf && !(owner && fact.verifiedLine)) return null;
  const where = fact.fromPdf ? (fact.pageNumber ? `page ${fact.pageNumber}` : "page unknown") : null;
  return (
    <Disclosure variant="inline" className="lg-factsource" summary={where ? `Show source (${where})` : "Details"}>
      {fact.quote && <p className="lg-quote lg-wrap-any">&ldquo;{fact.quote}&rdquo;</p>}
      {fact.fromPdf && fact.fileName && <p className="lg-factmeta">From {fact.fileName}</p>}
      {owner && fact.fromPdf && !fact.quoteFound && (
        <p className="lg-quotecheck lg-late">
          <WarningIcon size={16} />
          <span>Quote not found on that page, or it doesn&apos;t match the fact. Check the PDF.</span>
        </p>
      )}
      {owner && fact.verifiedLine && <p className="lg-factmeta">{fact.verifiedLine}</p>}
    </Disclosure>
  );
}
