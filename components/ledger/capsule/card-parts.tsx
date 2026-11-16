import type { ReactNode } from "react";
import Link from "next/link";
import { SECTIONS, SECTION_LABELS } from "@/lib/capsule/limits";
import type { CardBullet, CardFacts } from "@/lib/capsule/types";
import { formatYmd } from "@/lib/dates";
import { STAGE_LABELS } from "@/lib/stages";
import { StageGlyph } from "../icons";
import { contactSpan, monthName, plural } from "./format";

// The pieces of a relationship card that the owner's review and the published capsule share:
// the facts code read, and a bullet with its quote and a link to where it was written. No state,
// so they draw on the server.

export function StageChip({ stage }: { stage: CardFacts["stage"] }) {
  return (
    <span className="lg-badge lg-cap-stage" data-stage={stage}>
      <StageGlyph stage={stage} size={13} />
      {STAGE_LABELS[stage]}
    </span>
  );
}

// "4 outreach entries, 1 reply, Oct 5 to Dec 1." then who logged them, the template that got the
// reply, and the contacts' names and titles (never an email or a phone number).
export function FactsLine({ facts }: { facts: CardFacts }) {
  if (!facts) return null;
  const span = contactSpan(facts.firstContactAt, facts.lastContactAt);
  const senders = facts.senders.map((s) => `${s.name} (${s.count})`).join(", ");
  const contacts = facts.contacts.map((c) => (c.title ? `${c.name}, ${c.title}` : c.name)).join("; ");
  return (
    <p className="lg-cap-facts">
      <span>{plural(facts.outreachCount, "outreach entry", "outreach entries")}</span>
      <span>{plural(facts.replies, "reply", "replies")}</span>
      {span && <span>{span}</span>}
      {senders && <span>Logged by {senders}</span>}
      {facts.replyTemplates.length > 0 && <span>Replied after: {facts.replyTemplates.join(", ")}</span>}
      {contacts && <span>Contacts: {contacts}</span>}
    </p>
  );
}

// Bullets in the order of the sections (champions first), keeping each one's index on the card,
// which hiding a bullet needs.
export function bySection<T extends Pick<CardBullet, "section">>(bullets: readonly T[]): T[] {
  return [...bullets].sort((a, b) => SECTIONS.indexOf(a.section) - SECTIONS.indexOf(b.section));
}

export function BulletBody({ bullet, workspaceId, companyId }: { bullet: CardBullet; workspaceId: string; companyId: string }) {
  const month = bullet.section === "next" && bullet.month ? monthName(bullet.month) : null;
  const where = bullet.source.kind === "company" ? "the company's notes" : `an outreach note on ${formatYmd(bullet.source.sentAt.slice(0, 10))}`;
  return (
    <>
      <span className="lg-tag lg-cap-btag">{SECTION_LABELS[bullet.section]}</span>
      <p className="lg-cap-btext">
        {bullet.text}
        {month && <span className="lg-cap-month"> {month}</span>}
      </p>
      <p className="lg-cap-quote">
        <q className="lg-quote">{bullet.quote}</q>
        <span className="lg-hint">
          {" "}
          From {where}.{" "}
        </span>
        <Link className="lg-link lg-cap-src" href={`/${workspaceId}/companies/${companyId}${bullet.source.kind === "outreach" ? "#history" : ""}`}>
          Open the company page
        </Link>
      </p>
    </>
  );
}

export function Bullets({ bullets, workspaceId, companyId }: { bullets: readonly CardBullet[]; workspaceId: string; companyId: string }): ReactNode {
  if (bullets.length === 0) return <p className="lg-hint lg-cap-factsonly">Facts only. No notes were read for this card.</p>;
  return (
    <ul className="lg-cap-bullets">
      {bySection(bullets).map((bullet, i) => (
        <li key={i} className="lg-cap-bullet">
          <BulletBody bullet={bullet} workspaceId={workspaceId} companyId={companyId} />
        </li>
      ))}
    </ul>
  );
}
