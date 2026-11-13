import Link from "next/link";
import type { MemberView } from "@/lib/capsule";
import type { Playbook } from "@/lib/capsule";
import { formatYmd } from "@/lib/dates";
import { Disclosure } from "../disclosure";
import { ShowMore } from "../show-more";
import { Bullets, FactsLine, StageChip } from "./card-parts";
import { groupByStage, longDay, plural } from "./format";
import { PlaybookView } from "./playbook-view";

// The published capsule, read-only, for every member: the approved cards (grouped by stage, each
// bullet with its quote and a link to the company page), the playbook and the re-contact calendar.
// An owner sees this same view as "what officers see". Draws on the server.

export function PublishedCapsule({ workspaceId, view, playbook }: { workspaceId: string; view: MemberView; playbook: Playbook | null }) {
  const groups = groupByStage(view.cards);
  const dated = view.cards.filter((c) => c.recontactOn).sort((a, b) => (a.recontactOn as string).localeCompare(b.recontactOn as string) || a.companyName.localeCompare(b.companyName));
  return (
    <div className="lg-cap-published" data-tour="capsule-published">
      <p className="lg-hint">
        {plural(view.cards.length, "card", "cards")} from the board of {view.report.label}
        {view.report.publishedAt ? `, published ${longDay(view.report.publishedAt)}` : ""}. Read-only.
      </p>
      {groups.map((group) => (
        <section key={group.stage} className="lg-cap-group" aria-labelledby={`pub-${group.stage}`}>
          <h3 id={`pub-${group.stage}`} className="lg-cap-grouph">
            {group.label}
            <span className="lg-panel-count lg-num"> {group.items.length}</span>
          </h3>
          <ShowMore as="ul" initial={4} label={`${group.label.toLowerCase()} cards`} listClassName="lg-cap-cards">
            {group.items.map((card) => (
              <li key={card.id} className="lg-cap-card">
                <div className="lg-cap-cardhead">
                  <h4 className="lg-cap-name">
                    <Link className="lg-link" href={`/${workspaceId}/companies/${card.companyId}`}>
                      {card.companyName}
                    </Link>
                  </h4>
                  <StageChip stage={card.stage} />
                </div>
                <FactsLine facts={card.facts} />
                <Bullets bullets={card.bullets} workspaceId={workspaceId} companyId={card.companyId} />
              </li>
            ))}
          </ShowMore>
        </section>
      ))}
      {playbook && (
        <Disclosure summary="Playbook" className="lg-cap-more">
          <p className="lg-hint">Made from this board year&apos;s numbers, the same ones Template stats shows. No AI.</p>
          <PlaybookView playbook={playbook} />
        </Disclosure>
      )}
      <Disclosure summary="Re-contact calendar" count={dated.length} className="lg-cap-more">
        {dated.length === 0 ? (
          <p className="lg-muted">No company has a re-contact date in this capsule.</p>
        ) : (
          <ul className="lg-cap-dates">
            {dated.map((card) => (
              <li key={card.id}>
                <span className="lg-num lg-cap-datetxt">{formatYmd(card.recontactOn as string, { month: "short", day: "numeric", year: "numeric" })}</span>
                <Link className="lg-link" href={`/${workspaceId}/companies/${card.companyId}`}>
                  {card.companyName}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Disclosure>
    </div>
  );
}
