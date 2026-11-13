import type { Stage } from "@/generated/prisma/enums";
import type { Section } from "./limits";

// What a relationship card holds, as stored in RelationshipCard.bullets: the facts code read from
// the database when the card was made, and the bullets the model wrote that passed every check.

// Facts read by code only. Names come from the database. Contacts are a name and a title: the
// company page has the rest, and no email or phone number is copied into a card.
export type CardFacts = {
  stage: Stage;
  outreachCount: number;
  replies: number;
  // ISO times of the first and last outreach in the board year.
  firstContactAt: string | null;
  lastContactAt: string | null;
  // Who logged the outreach this board year, most first.
  senders: { name: string; count: number }[];
  // The templates on outreach that was marked as the reply.
  replyTemplates: string[];
  contacts: { name: string; title: string | null }[];
};

// Where a bullet's quote was found: the company's notes field, or one outreach entry's note.
export type BulletSource = { kind: "company" } | { kind: "outreach"; outreachId: string; sentAt: string };

export type CardBullet = {
  section: Section;
  text: string;
  quote: string;
  source: BulletSource;
  // 1 to 12, only on a "next" bullet, and only when code found that month or a date in it in the quote.
  month: number | null;
};

export type CardBody = { facts: CardFacts; bullets: CardBullet[] };

// Narrowing for the Json column.
export function cardBody(value: unknown): CardBody {
  const v = (value ?? {}) as Partial<CardBody>;
  return { facts: v.facts as CardFacts, bullets: Array.isArray(v.bullets) ? v.bullets : [] };
}
