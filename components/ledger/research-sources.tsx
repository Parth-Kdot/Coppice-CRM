import { ActionForm } from "@/components/action-form";
import type { SourceView } from "@/lib/research/sources";
import { SOURCE_LABEL_MAX } from "@/lib/limits";
import type { ActionResult } from "@/lib/validation";
import { SOURCE_URL_MAX } from "@/lib/research/urls";
import { day } from "@/lib/dates";
import "./pages.css";
import "./settings.css";
import "./research.css";

type Action = (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;

// Settings: the pages research briefs may read. Owners add, label and archive them; officers see
// the list. Kept in its own file so the settings page only gains one section.
export function ResearchSourcesSection({
  workspaceId,
  sources,
  isOwner,
  aiOn,
  actions,
}: {
  workspaceId: string;
  sources: SourceView[];
  isOwner: boolean;
  aiOn: boolean;
  actions: { add: Action; rename: Action; archive: Action };
}) {
  const ids = <input type="hidden" name="workspaceId" value={workspaceId} />;
  return (
    <section id="research-sources" className="lg-sec" aria-labelledby="set-research">
      <div className="lg-sec-label">
        <h2 id="set-research" className="lg-sec-title">
          Research pages
        </h2>
        <p className="lg-sec-sub">The only pages a &ldquo;Who to contact&rdquo; brief may read.</p>
      </div>
      <div className="lg-sec-body">
        <p className="max-w-[66ch]">
          Coppice fetches only these pages (and redirects that stay on their sites), never links on them, never LinkedIn or people-search
          sites, and never a company&apos;s own website unless it is listed here. It honors each site&apos;s robots.txt.
        </p>
        {!aiOn && <p className="lg-hint mt-2">Briefs are hidden while AI is off for this workspace.</p>}
        {sources.length === 0 ? (
          <p className="lg-muted mt-3">No pages yet.</p>
        ) : (
          <ul className="lg-sourcelist mt-3">
            {sources.map((source) => (
              <li key={source.id} className="lg-source">
                <p>
                  <strong>{source.label}</strong>
                </p>
                <p className="lg-hint">{source.url}</p>
                <p className="lg-membermeta">
                  Added by {source.addedBy.name} on {day(source.createdAt)}
                </p>
                {isOwner && (
                  <div className="lg-source-acts">
                    <ActionForm
                      action={actions.archive}
                      submitLabel="Archive"
                      confirmMessage={`Archive ${source.label}? Briefs stop reading it; old briefs keep what they read.`}
                      successMessage={`${source.label} archived.`}
                      small
                    >
                      {ids}
                      <input type="hidden" name="sourceId" value={source.id} />
                    </ActionForm>
                    <details className="lg-factedit">
                      <summary>Rename</summary>
                      <ActionForm action={actions.rename} submitLabel="Save label" successMessage="Label saved." className="lg-editform" small>
                        {ids}
                        <input type="hidden" name="sourceId" value={source.id} />
                        <label className="lg-label" htmlFor={`label-${source.id}`}>
                          Label
                        </label>
                        <input id={`label-${source.id}`} name="label" required maxLength={SOURCE_LABEL_MAX} defaultValue={source.label} className="lg-input" />
                      </ActionForm>
                    </details>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {isOwner && (
          <ActionForm action={actions.add} submitLabel="Add page" successMessage="Page added." className="lg-sourceform" primary>
            {ids}
            <div>
              <label className="lg-label" htmlFor="source-url">
                Page address
              </label>
              <input
                id="source-url"
                name="url"
                required
                maxLength={SOURCE_URL_MAX}
                inputMode="url"
                autoComplete="off"
                placeholder="careers.acme.com/students"
                className="lg-input"
              />
            </div>
            <div>
              <label className="lg-label" htmlFor="source-label">
                Label (optional)
              </label>
              <input id="source-label" name="label" maxLength={SOURCE_LABEL_MAX} placeholder="Acme students" className="lg-input" />
            </div>
          </ActionForm>
        )}
      </div>
    </section>
  );
}
