import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { archiveTemplate, createTemplate, unarchiveTemplate, updateTemplate } from "@/app/(app)/[workspaceId]/settings/template-actions";
import type { Membership } from "@/lib/authz";
import { listTemplates, type TemplateRow } from "@/lib/templates";
import { TEMPLATE_LIMITS } from "@/lib/validation";
import "./templates.css";

// The Templates section of Settings, in the same margin-and-rows layout as the rest of the page.
// Owners add, edit, archive and unarchive; officers read the list. There is no delete: a template
// that was used keeps its history in the stats, so archiving is how one is retired.

const PLACEHOLDER_HINT = "Use {{firstName}}, {{senderName}} and {{orgName}} for the names. No other {{...}} is allowed.";

function TemplateInputs({ idPrefix, name = "", body = "" }: { idPrefix: string; name?: string; body?: string }) {
  return (
    <>
      <div>
        <label className="lg-label" htmlFor={`${idPrefix}-name`}>
          Name
        </label>
        <input id={`${idPrefix}-name`} name="name" required maxLength={TEMPLATE_LIMITS.name} defaultValue={name} className="lg-input" />
      </div>
      <div>
        <label className="lg-label" htmlFor={`${idPrefix}-body`}>
          Text
        </label>
        <textarea
          id={`${idPrefix}-body`}
          name="body"
          required
          maxLength={TEMPLATE_LIMITS.body}
          rows={6}
          defaultValue={body}
          aria-describedby={`${idPrefix}-hint`}
          className="lg-textarea"
        />
        <p id={`${idPrefix}-hint`} className="lg-hint mt-1">
          {PLACEHOLDER_HINT}
        </p>
      </div>
    </>
  );
}

const usedLine = (uses: number) => (uses === 0 ? "Not used yet" : uses === 1 ? "Used once" : `Used ${uses} times`);

export async function TemplatesSection({ me, workspaceId }: { me: Membership; workspaceId: string }) {
  const isOwner = me.role === "owner";
  const all = await listTemplates({ userId: me.userId, workspaceId });
  const active = all.filter((t) => t.archivedAt === null);
  const archived = all.filter((t) => t.archivedAt !== null);
  const ids = <input type="hidden" name="workspaceId" value={workspaceId} />;

  const row = (t: TemplateRow) => (
    <li key={t.id} className="lg-tpl" data-archived={t.archivedAt !== null || undefined}>
      <p className="lg-tplhead">
        <strong className="lg-tplname">{t.name}</strong>
        {t.archivedAt && <span className="lg-badge lg-badge-stale">Archived</span>}
        <span className="lg-muted lg-num">{usedLine(t.uses)}</span>
      </p>
      <p className="lg-tpltext">{t.body}</p>
      {isOwner && (
        <div className="lg-factacts">
          {t.archivedAt === null ? (
            <>
              <details className="lg-factedit">
                <summary>Edit</summary>
                <ActionForm action={updateTemplate} submitLabel="Save template" successMessage="Template saved." className="lg-editform" small>
                  {ids}
                  <input type="hidden" name="templateId" value={t.id} />
                  <TemplateInputs idPrefix={`tpl-${t.id}`} name={t.name} body={t.body} />
                  {t.uses > 0 && <p className="lg-hint">Outreach already logged keeps counting for this template. For a real rewrite, archive it and add a new one.</p>}
                </ActionForm>
              </details>
              <ActionForm
                action={archiveTemplate}
                submitLabel="Archive"
                successMessage={`${t.name} archived.`}
                confirmMessage={`Archive ${t.name}? It leaves the pickers; its stats are kept and you can unarchive it.`}
                small
              >
                {ids}
                <input type="hidden" name="templateId" value={t.id} />
              </ActionForm>
            </>
          ) : (
            <ActionForm action={unarchiveTemplate} submitLabel="Unarchive" successMessage={`${t.name} is back in the pickers.`} small>
              {ids}
              <input type="hidden" name="templateId" value={t.id} />
            </ActionForm>
          )}
        </div>
      )}
    </li>
  );

  return (
    <section className="lg-sec" aria-labelledby="set-templates">
      <div className="lg-sec-label">
        <h2 id="set-templates" className="lg-sec-title">
          Templates
        </h2>
        <p className="lg-sec-sub">Emails your officers send again and again. Pick one when logging outreach, and stats show which get replies.</p>
      </div>
      <div className="lg-sec-body">
        {active.length === 0 ? (
          <p className="lg-muted">{isOwner ? "No templates yet. Add your first one below." : "No templates yet. An owner adds them here."}</p>
        ) : (
          <ul className="lg-tpls">{active.map(row)}</ul>
        )}
        {archived.length > 0 && (
          <section className="lg-tplgroup" aria-label="Archived templates">
            <h3 className="lg-factgroup-h lg-tag">Archived, kept for stats</h3>
            <ul className="lg-tpls">{archived.map(row)}</ul>
          </section>
        )}
        <p className="mt-3">
          <Link href={`/${workspaceId}/stats`} className="lg-link">
            See which templates get replies
          </Link>
        </p>
        {isOwner ? (
          <div className="lg-tpladd">
            <h3 className="lg-tag">Add a template</h3>
            <ActionForm action={createTemplate} submitLabel="Add template" successMessage="Template added." className="lg-editform">
              {ids}
              <TemplateInputs idPrefix="tpl-new" />
            </ActionForm>
          </div>
        ) : (
          <p className="lg-hint mt-2">Only owners add, edit or archive templates.</p>
        )}
      </div>
    </section>
  );
}
