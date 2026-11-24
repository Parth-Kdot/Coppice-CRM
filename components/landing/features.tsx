import { EngravedBoard, EngravedClaim, EngravedDraft, EngravedFacts, EngravedImport, EngravedLog, EngravedQueue } from "../ledger/icons";
import { FEATURES } from "./copy";

const ICONS = {
  claim: EngravedClaim,
  queue: EngravedQueue,
  board: EngravedBoard,
  log: EngravedLog,
  import: EngravedImport,
  facts: EngravedFacts,
  draft: EngravedDraft,
  stats: EngravedLog,
  smart: EngravedImport,
  brief: EngravedFacts,
  assistants: EngravedClaim,
} as const;

// Features: one ruled column. The engraved icon sits in the margin, the title and its one line in
// the middle, and the detail on the right.
export function Features() {
  return (
    <section id="features" className="ld-sec ld-features" aria-labelledby="features-title">
      <div className="ld-wrap">
        <header className="ld-features-head">
          <h2 id="features-title" className="ld-h2">
            {FEATURES.headline}
          </h2>
        </header>

        <ol className="ld-index">
          {FEATURES.items.map((item) => {
            const Icon = ICONS[item.icon as keyof typeof ICONS];
            return (
              <li key={item.title} className="ld-entry">
                <Icon size={48} className="ld-entry-icon" />
                <div>
                  <h3 className="ld-h3 ld-entry-title">{item.title}</h3>
                  <p className="ld-entry-short">{item.short}</p>
                  {"tag" in item && item.tag ? <span className="ld-entry-tag">{item.tag}</span> : null}
                </div>
                <p className="ld-entry-long">{item.detail}</p>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
