"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { EditDetailsContext } from "@/components/company-form";
import { useStageMove } from "@/components/stage-form";
import type { LookAlike } from "@/lib/companies";
import { focusSoon } from "../focus";
import { ExternalIcon } from "../icons";
import { removeAway, restore } from "../motion-kit";
import { OverflowMenu, type OverflowItem } from "../overflow-menu";
import { Clamp } from "./block";
import type { Action } from "./types";
import "../company.css";
import "../templates.css";

type HeaderMenu = {
  workspaceId: string;
  companyId: string;
  // Edit details: everywhere but an archived company.
  canEdit: boolean;
  // Archive and the stage moves in the menu: whoever the server lets do them.
  canControl: boolean;
  // "Move to…" in the menu (an owner on someone else's claim), "Reopen…" (a closed company).
  stageItem: "move" | "reopen" | null;
  archive?: Action;
  archiveAsDuplicate?: Action;
  lookAlikes: LookAlike[];
};

export function CompanyHeader({
  name,
  industry,
  website,
  href,
  host,
  meta,
  notes,
  menu,
  editForm,
}: {
  name: string;
  industry: string | null;
  website: string | null;
  href: string | null;
  host: string | null;
  // The follow-up or outcome line, drawn on the server.
  meta: ReactNode;
  notes: string | null;
  menu: HeaderMenu | null;
  editForm: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const stage = useStageMove();
  // Archive, once confirmed: the working column (the claim ticket, the log form, outreach) slides
  // away while the server archives it, and the rest of the sheet dims and holds until the archived
  // page, drawn by the same render, takes its place, so the page is never blank in between. A
  // refusal brings everything back.
  const archiveAction = menu?.archive;
  const archive = useCallback<Action>(
    async (prev, form) => {
      if (!archiveAction) return { ok: false, error: "Archive is not available here." };
      const sheet = document.querySelector<HTMLElement>(".lg-company .lg-cogrid");
      const side = sheet?.querySelector<HTMLElement>(".lg-co-side") ?? null;
      const back = () => {
        restore(side);
        sheet?.removeAttribute("data-archiving");
      };
      const leaving = removeAway(side, { direction: "right", distance: 24, collapse: false, focus: document.querySelector<HTMLElement>(".lg-company .lg-back") });
      sheet?.setAttribute("data-archiving", "");
      try {
        const result = await archiveAction(prev, form);
        if (!result.ok) back();
        else await leaving;
        return result;
      } catch (error) {
        back();
        throw error;
      }
    },
    [archiveAction],
  );
  const fields: Record<string, string> = menu ? { workspaceId: menu.workspaceId, companyId: menu.companyId } : {};
  const items: OverflowItem[] = [];
  if (menu?.canEdit) {
    items.push({
      key: "edit",
      label: "Edit details",
      hint: "Name, industry, website, notes",
      onSelect: () => {
        setEditing(true);
        focusSoon('.lg-coedit input[name="name"]');
      },
    });
  }
  if (menu?.canControl && menu.stageItem && stage) {
    items.push({
      key: "stage",
      label: menu.stageItem === "reopen" ? "Reopen…" : "Move to…",
      hint: menu.stageItem === "reopen" ? "Move it back to an earlier stage" : undefined,
      onSelect: () => {
        const button = document.querySelector<HTMLElement>('[data-tour="company-more"]');
        if (button) stage.open(button);
      },
    });
  }
  if (menu?.canControl && menu.archiveAsDuplicate) {
    for (const other of menu.lookAlikes) {
      items.push({
        key: `dup-${other.id}`,
        label: `Same as ${other.name}: archive this one`,
        danger: true,
        action: menu.archiveAsDuplicate,
        fields: { ...fields, keepId: other.id },
        confirmMessage: `Archive ${name} as a duplicate of ${other.name}? ${other.name} opens next. Its history is kept.`,
      });
    }
  }
  if (menu?.canControl && menu.archive) {
    items.push({
      key: "archive",
      label: "Archive",
      hint: "Hide it from the board and queue",
      danger: true,
      action: archive,
      fields,
      confirmMessage: `Archive ${name}? It leaves the board and queue. Its history is kept and you can unarchive it.`,
      successMessage: `${name} archived.`,
      focusAfter: "#archived-banner",
    });
  }

  // Edit details opens CompanyForm in place under the header; the form closes it after a save or on Cancel.
  const ctx = useMemo(
    () => ({
      close: (saved: boolean) => {
        setEditing(false);
        focusSoon(saved ? ".lg-company h1" : '[data-tour="company-more"]');
      },
    }),
    [],
  );

  return (
    <header className="lg-cohead">
      <div className="lg-cotitle">
        <h1 className="lg-h1 lg-coname" tabIndex={-1} title={name}>
          {name}
        </h1>
        {items.length > 0 && <OverflowMenu label={`More actions for ${name}`} items={items} data-tour="company-more" />}
      </div>
      {(industry || website || meta) && (
        <p className="lg-coline">
          {industry && (
            <span className="lg-trunc" title={industry}>
              {industry}
            </span>
          )}
          {website &&
            (href ? (
              <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="lg-link lg-cosite" title={website} aria-label={`${website} (opens in a new tab)`}>
                <span className="lg-trunc">{host ?? website}</span>
                <ExternalIcon size={14} className="lg-cosite-icon" />
              </a>
            ) : (
              <span className="lg-trunc" title={website}>
                {website}
              </span>
            ))}
          {meta}
        </p>
      )}
      {notes && !editing && <Clamp text={notes} className="lg-conotes" />}
      {editing && (
        <div className="lg-coedit">
          <EditDetailsContext value={ctx}>{editForm}</EditDetailsContext>
        </div>
      )}
    </header>
  );
}
