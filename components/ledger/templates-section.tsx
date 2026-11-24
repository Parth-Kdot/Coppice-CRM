import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { archiveTemplate, createTemplate, unarchiveTemplate, updateTemplate } from "@/app/(app)/[workspaceId]/settings/template-actions";
import { Disclosure, LazyDisclosure } from "@/components/ledger/disclosure";
import { ShowMore } from "@/components/ledger/show-more";
import type { TemplateRow } from "@/lib/templates";
import { StampOnNew } from "./stamp-on-new";
import { TemplateInputs } from "./template-inputs";
import "./templates.css";
import "./settings.css";

// The Templates section of Settings: collapsed to one line ("Templates 4"), and inside it one row
// per template (name · used N times) that opens to the text. Owners get Edit (the form mounts only
// when opened, so sixty templates don't render sixty hidden forms) and Archive in the opened row,
// "Add a template" at the end, and the archived ones in their own "Archived" disclosure with
// Unarchive. Officers read the rows. There is no delete: a template that was used keeps its
// history in the stats, so archiving is how one is retired. The page loads the rows
// (listTemplates) alongside its other queries and passes them in. A template just added or brought
// back lands with a stamp, and archiving one stamps the "Archived" line (StampOnNew).

// Rows shown before "Show all N templates".
const TEMPLATES_SHOWN = 10;

const usedLine = (uses: number) => (uses === 0 ? "Not used yet" : uses === 1 ? "Used once" : `Used ${uses} times`);

export function TemplatesSection({ isOwner, workspaceId, templates }: { isOwner: boolean; workspaceId: string; templates: TemplateRow[] }) {
  const active = templates.filter((t) => t.archivedAt === null);
  const archived = templates.filter((t) => t.archivedAt !== null);
  // Officers have nothing to do here until an owner adds one.
  if (!isOwner && templates.length === 0) return null;
  const ids = <input type="hidden" name="workspaceId" value={workspaceId} />;

  const row = (t: TemplateRow) => (
    <li key={t.id} className="lg-tplrow" data-archived={t.archivedAt !== null || undefined} data-stamp-id={t.id}>
      <Disclosure variant="inline" className="lg-tplrow-disc" summary={<span className="lg-tplname">{t.name}</span>} count={usedLine(t.uses)}>
        {/* The whole text, unclipped (settings.css), so nothing needs scrolling inside a box. */}
        <p className="lg-tpltext">{t.body}</p>
        {isOwner && (
          <div className="lg-tplrow-acts">
            {t.archivedAt === null ? (
              <>
                <LazyDisclosure
                  variant="inline"
                  summary={
                    <>
                      Edit<span className="lg-sr"> {t.name}</span>
                    </>
                  }
                >
                  <ActionForm
                    action={updateTemplate}
                    submitLabel="Save template"
                    submitAriaLabel={`Save ${t.name}`}
                    successMessage="Template saved."
                    savedNote
                    className={`lg-editform lg-tpledit-${t.id}`}
                    focusAfter={`.lg-tpledit-${t.id} button[type=submit]`}
                    small
                  >
                    {ids}
                    <input type="hidden" name="templateId" value={t.id} />
                    <TemplateInputs key={`${t.name}\n${t.body}`} idPrefix={`tpl-${t.id}`} name={t.name} body={t.body} />
                    {t.uses > 0 && <p className="lg-hint">Outreach already logged keeps counting for this template. For a real rewrite, archive it and add a new one.</p>}
                  </ActionForm>
                </LazyDisclosure>
                <ActionForm
                  action={archiveTemplate}
                  submitLabel="Archive"
                  submitAriaLabel={`Archive ${t.name}`}
                  successMessage={`${t.name} archived.`}
                  confirmMessage={`Archive ${t.name}? It leaves the pickers; its stats are kept and you can unarchive it.`}
                  focusAfter="#templates > summary"
                  submitClassName="lg-btn-quiet"
                  className="lg-tplarchive"
                  small
                >
                  {ids}
                  <input type="hidden" name="templateId" value={t.id} />
                </ActionForm>
              </>
            ) : (
              <ActionForm
                action={unarchiveTemplate}
                submitLabel="Unarchive"
                submitAriaLabel={`Unarchive ${t.name}`}
                successMessage={`${t.name} is back in the pickers.`}
                focusAfter="#templates > summary"
                small
              >
                {ids}
                <input type="hidden" name="templateId" value={t.id} />
              </ActionForm>
            )}
          </div>
        )}
      </Disclosure>
    </li>
  );

  return (
    <Disclosure id="templates" summary="Templates" count={active.length === 0 ? "None yet" : active.length}>
      {active.length === 0 ? (
        <p className="lg-muted">No templates yet. Add one for the emails officers send again and again.</p>
      ) : (
        <StampOnNew ids={active.map((t) => t.id)}>
          <ShowMore initial={TEMPLATES_SHOWN} label="templates" as="ul" listClassName="lg-tplrows">
            {active.map(row)}
          </ShowMore>
        </StampOnNew>
      )}
      {active.length > 0 && (
        <p className="lg-set-note">
          <Link href={`/${workspaceId}/stats`} className="lg-link">
            See which templates get replies
          </Link>
        </p>
      )}
      {isOwner && (
        <LazyDisclosure variant="inline" summary="Add a template" className="lg-tpladd-disc">
          <ActionForm action={createTemplate} submitLabel="Add template" successMessage="Template added." className="lg-editform" focusAfter="#tpl-new-name">
            {ids}
            {/* Keyed by the count, so the boxes empty once a template is added. */}
            <TemplateInputs key={templates.length} idPrefix="tpl-new" />
          </ActionForm>
        </LazyDisclosure>
      )}
      {/* Archiving one stamps the "Archived" line it folded into. */}
      <StampOnNew ids={archived.map((t) => t.id)} target=".lg-tplarch > summary">
        {archived.length > 0 && (
          <Disclosure variant="inline" summary="Archived" count={archived.length} className="lg-tplarch">
            <ShowMore initial={TEMPLATES_SHOWN} label="archived templates" as="ul" listClassName="lg-tplrows">
              {archived.map(row)}
            </ShowMore>
          </Disclosure>
        )}
      </StampOnNew>
    </Disclosure>
  );
}
