import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { ExternalIcon, WarningIcon } from "@/components/ledger/icons";
import { Tick } from "@/components/ledger/marks";
import type { BriefView } from "@/lib/research/brief";
import { ASK_CHANGED, FLAG_LABELS, SECTION_HEADINGS } from "@/lib/research/sections";
import type { ActionResult } from "@/lib/validation";

// The research brief's sections besides its doors (components/brief-panel.tsx): campus ties, red
// flags, the outreach hook and the suggested ask. Each quotes the fetched page it came from, links
// to that page only, and has its own "Add to notes". An empty section draws nothing.

export type SectionProps = {
  workspaceId: string;
  companyId: string;
  brief: BriefView;
  isOwner: boolean;
  // Whether the workspace has a verified fact that names a tier or price (lib/research/section-checks.ts).
  hasTierFacts: boolean;
  accept: (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;
};

// A link's text: the page without its scheme, so the reader sees where it goes.
export const shortUrl = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/$/, "");

type AddProps = Pick<SectionProps, "workspaceId" | "companyId" | "accept"> & { briefId: string; itemId: string; accepted: boolean };

// "Add to notes" for one entry or inbox, or a mark once it is in the notes.
export function AddToNotes(props: AddProps) {
  if (props.accepted) {
    return (
      <p className="lg-brief-added">
        <Tick size={18} />
        In the notes
      </p>
    );
  }
  return (
    <ActionForm action={props.accept} submitLabel="Add to notes" successMessage="Added to the notes." small>
      <input type="hidden" name="workspaceId" value={props.workspaceId} />
      <input type="hidden" name="companyId" value={props.companyId} />
      <input type="hidden" name="briefId" value={props.briefId} />
      <input type="hidden" name="itemId" value={props.itemId} />
    </ActionForm>
  );
}

// The quote and the one link it may carry: the fetched page it is on.
function Quote({ quote, url }: { quote: string; url: string }) {
  return (
    <blockquote className="lg-brief-quote">
      <p className="lg-quote">&ldquo;{quote}&rdquo;</p>
      <footer>
        <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="lg-link">
          {shortUrl(url)}
          <ExternalIcon size={14} className="ml-1 inline-block align-[-2px]" />
        </a>
      </footer>
    </blockquote>
  );
}

const add = (props: SectionProps, entry: { id: string; accepted: boolean }) => (
  <AddToNotes workspaceId={props.workspaceId} companyId={props.companyId} accept={props.accept} briefId={props.brief.id} itemId={entry.id} accepted={entry.accepted} />
);

export function CampusTies(props: SectionProps) {
  if (props.brief.ties.length === 0) return null;
  return (
    <section className="lg-brief-section" aria-label={SECTION_HEADINGS.ties}>
      <h4 className="lg-tag lg-brief-section-h">{SECTION_HEADINGS.ties}</h4>
      <ul className="lg-brief-items">
        {props.brief.ties.map((tie) => (
          <li key={tie.id} className="lg-brief-item">
            <p className="lg-brief-title">
              <strong>{tie.title}</strong>
            </p>
            <p>{tie.detail}</p>
            <Quote quote={tie.quote} url={tie.url} />
            {add(props, tie)}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function RedFlags(props: SectionProps) {
  if (props.brief.flags.length === 0) return null;
  return (
    <section className="lg-brief-section" aria-label={SECTION_HEADINGS.flags}>
      <h4 className="lg-tag lg-brief-section-h">{SECTION_HEADINGS.flags}</h4>
      <p className="lg-hint">Read each one on its page. A stated deadline or application window is quoted as the page has it; Coppice doesn&apos;t check the date.</p>
      <ul className="lg-brief-flags">
        {props.brief.flags.map((flag) => (
          <li key={flag.id} className="lg-brief-flag">
            <WarningIcon size={18} />
            <div>
              <p className="lg-brief-door lg-tag">{FLAG_LABELS[flag.kind]}</p>
              <p className="lg-brief-title">
                <strong>{flag.title}</strong>
              </p>
              <Quote quote={flag.quote} url={flag.url} />
              {add(props, flag)}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function OutreachHook(props: SectionProps) {
  const { hook } = props.brief;
  if (!hook) return null;
  return (
    <section className="lg-brief-section" aria-label={SECTION_HEADINGS.hook}>
      <h4 className="lg-tag lg-brief-section-h">{SECTION_HEADINGS.hook}</h4>
      <div className="lg-brief-item">
        <p>{hook.line}</p>
        <Quote quote={hook.quote} url={hook.url} />
        {add(props, hook)}
      </div>
    </section>
  );
}

export function SuggestedAsk(props: SectionProps) {
  const { ask } = props.brief;
  if (!ask) {
    if (props.hasTierFacts) return null;
    // No tier to suggest from: say how to get one.
    return (
      <section className="lg-brief-section" aria-label={SECTION_HEADINGS.ask}>
        <h4 className="lg-tag lg-brief-section-h">{SECTION_HEADINGS.ask}</h4>
        <p className="lg-hint">
          {props.isOwner ? (
            <Link href={`/${props.workspaceId}/facts`} className="lg-link">
              Verify a tier on the fact sheet to get a suggested ask
            </Link>
          ) : (
            "An owner can verify a tier on the fact sheet to get a suggested ask."
          )}
        </p>
      </section>
    );
  }
  return (
    <section className="lg-brief-section" aria-label={SECTION_HEADINGS.ask}>
      <h4 className="lg-tag lg-brief-section-h">{SECTION_HEADINGS.ask}</h4>
      <div className="lg-brief-item">
        <p className="lg-brief-asktier">
          {/* A changed ask no longer names a fact the workspace stands by, so it isn't called verified. */}
          <span className="lg-tag">{ask.changed ? "Tier fact, since changed" : "Verified fact"}</span>{" "}
          {ask.old && <span className="lg-badge lg-badge-stale">Over a year old</span>}
        </p>
        <p className="lg-brief-title">
          <strong>{ask.factText}</strong>
        </p>
        <p>{ask.reason}</p>
        <Quote quote={ask.quote} url={ask.url} />
        {ask.changed ? (
          <p className="lg-hint lg-late">{ASK_CHANGED}</p>
        ) : (
          add(props, ask)
        )}
      </div>
    </section>
  );
}

// Every section, in the order the card shows them.
export function BriefSections(props: SectionProps) {
  return (
    <>
      <CampusTies {...props} />
      <RedFlags {...props} />
      <OutreachHook {...props} />
      <SuggestedAsk {...props} />
    </>
  );
}
