import type { Stage } from "@/generated/prisma/client";

// The made-up people, templates and companies behind the demo workspace. Everything here is
// fictional: the companies, people and websites (all *.example.com, a domain reserved for
// examples) do not exist. prisma/seed-rows.ts turns this into rows; prisma/seed-demo.ts writes them.

export const DEMO_WORKSPACE_ID = "demo-riverbend";

// Index 0 is the owner, the rest are officers (role "member").
export const PEOPLE = [
  { id: "demo-user-dana", name: "Dana Whitfield", role: "owner" },
  { id: "demo-user-marcus", name: "Marcus Oyelaran", role: "member" },
  { id: "demo-user-priya", name: "Priya Nandakumar", role: "member" },
  { id: "demo-user-jonah", name: "Jonah Pereira", role: "member" },
  { id: "demo-user-sofia", name: "Sofia Lindqvist", role: "member" },
] as const;
export const emailOf = (name: string) => `${name.toLowerCase().replace(/ /g, ".")}@example.com`;

export const TEMPLATES = {
  intro: {
    id: "demo-tpl-intro",
    name: "Intro email",
    body: "Hi {{firstName}},\n\nI'm {{senderName}} with {{orgName}}. We are putting together our spring showcase and looking for local companies who would like to be part of it. I can send a one-page overview if that would help.\n\nThanks for reading,\n{{senderName}}",
    archived: false,
  },
  followUp: {
    id: "demo-tpl-follow-up",
    name: "Gentle follow-up",
    body: "Hi {{firstName}},\n\nJust following up on my earlier note from {{orgName}}. Happy to answer questions or set up a quick call, whatever is easiest for you.\n\nBest,\n{{senderName}}",
    archived: false,
  },
  retired: {
    id: "demo-tpl-fall-pitch",
    name: "Fall pitch (retired)",
    body: "Hello {{firstName}},\n\n{{orgName}} is looking for partners for the fall semester. If a short conversation sounds worthwhile, reply here and I will find a time.\n\nRegards,\n{{senderName}}",
    archived: true,
  },
};

export type Spec = {
  name: string;
  slug: string;
  industry: string;
  stage: Stage;
  // Index into PEOPLE: who works this company.
  by: number;
  // Days ago of the first touch, days between touches, touches up to and including the reply (or
  // all touches, if there was no reply), and touches after the reply.
  first?: number;
  gap?: number;
  pre?: number;
  post?: number;
  // Whether the company ever answered. Replied, in conversation and committed always did.
  replied?: boolean;
  // Follow-up date in days from today: negative is overdue, 0 is due today.
  due?: number;
  claim?: "live" | "expired";
  linkedin?: boolean;
  note?: string;
  contacts?: string[];
};

// "First Last, Title". Emails are first.last@<company>.example.com.
export const SPECS: Spec[] = [
  // Not contacted: fresh leads.
  { name: "Lumenfield Labs", slug: "lumenfield", industry: "Software", stage: "NOT_CONTACTED", by: 1, contacts: ["Elena Brandt, Partnerships Manager"], note: "Their careers page mentions community sponsorships." },
  { name: "Ferncliff Foods", slug: "ferncliff", industry: "Food & beverage", stage: "NOT_CONTACTED", by: 2, contacts: ["Tobias Reinholt, Marketing Director"] },
  { name: "Oakmere Logistics", slug: "oakmere", industry: "Logistics", stage: "NOT_CONTACTED", by: 3 },
  { name: "Pinebrook Dental Group", slug: "pinebrook", industry: "Healthcare", stage: "NOT_CONTACTED", by: 4, contacts: ["Amara Osei, Office Manager"] },
  { name: "Saltmarsh Brewing", slug: "saltmarsh", industry: "Food & beverage", stage: "NOT_CONTACTED", by: 1, contacts: ["Wes Holloran, Owner"], note: "Taproom is a short walk from campus." },
  { name: "Kestrel Ridge Aerospace", slug: "kestrel-ridge", industry: "Aerospace", stage: "NOT_CONTACTED", by: 2, claim: "live", contacts: ["Ingrid Salazar, University Relations"] },
  { name: "Marrowgate Games", slug: "marrowgate", industry: "Gaming", stage: "NOT_CONTACTED", by: 3, contacts: ["Dev Malhotra, Community Lead"] },
  { name: "Copperleaf Energy", slug: "copperleaf", industry: "Energy", stage: "NOT_CONTACTED", by: 4 },
  { name: "Wickerby Furniture", slug: "wickerby", industry: "Retail", stage: "NOT_CONTACTED", by: 0, contacts: ["Naomi Eastwood, Store Manager"] },
  // Same website as Quillon Software below: a look-alike a person has not looked at yet.
  { name: "Quillon Software Inc.", slug: "quillon", industry: "Software", stage: "NOT_CONTACTED", by: 0, note: "Added from a second list. May be the same company as Quillon Software." },

  // Contacted.
  { name: "Brindle & Finch Law", slug: "brindle-finch", industry: "Legal services", stage: "CONTACTED", by: 0, first: 21, gap: 7, pre: 3, due: -2, contacts: ["Harriet Voss, Managing Partner"] },
  { name: "Quillon Software", slug: "quillon", industry: "Software", stage: "CONTACTED", by: 1, first: 12, gap: 6, pre: 2, due: 0, claim: "live", linkedin: true, contacts: ["Rafael Dominguez, Head of People", "Mina Park, Recruiter"] },
  { name: "Harborlight Credit Union", slug: "harborlight", industry: "Finance", stage: "CONTACTED", by: 2, first: 9, gap: 5, pre: 2, due: 3, contacts: ["Clara Whitcombe, Community Outreach"] },
  { name: "Tamarack Freight", slug: "tamarack", industry: "Logistics", stage: "CONTACTED", by: 3, first: 30, gap: 10, pre: 3, due: -4, contacts: ["Gideon Fairweather, Operations Director"] },
  { name: "Alderbrook Analytics", slug: "alderbrook", industry: "Data & analytics", stage: "CONTACTED", by: 0, first: 40, gap: 12, pre: 3, due: -9, claim: "expired", contacts: ["Leila Nakamura, Founder"] },
  { name: "Sunmeadow Farms Co-op", slug: "sunmeadow", industry: "Agriculture", stage: "CONTACTED", by: 1, first: 5, pre: 1, due: 5, claim: "live", contacts: ["Bram Oduya, Co-op Coordinator"] },
  { name: "Fairhollow Insurance", slug: "fairhollow", industry: "Finance", stage: "CONTACTED", by: 2, first: 18, gap: 9, pre: 2, due: 2, linkedin: true, contacts: ["Celeste Marchetti, Agency Principal"] },
  { name: "Ironvale Machining", slug: "ironvale", industry: "Manufacturing", stage: "CONTACTED", by: 3, first: 26, gap: 13, pre: 2, due: -6 },

  // Replied.
  { name: "Velvet Anchor Coffee", slug: "velvet-anchor", industry: "Food & beverage", stage: "REPLIED", by: 1, first: 14, gap: 7, pre: 2, due: 1, claim: "live", contacts: ["Odette Laurent, Co-owner"] },
  { name: "Larkspur Biotech", slug: "larkspur", industry: "Biotech", stage: "REPLIED", by: 2, first: 40, gap: 12, pre: 3, due: -8, claim: "expired", contacts: ["Dr. Emeka Adeyemi, Director of Operations"] },
  { name: "Mosswood Construction", slug: "mosswood", industry: "Construction", stage: "REPLIED", by: 3, first: 19, gap: 8, pre: 2, due: -5, contacts: ["Frances Delacroix, Project Coordinator"] },
  { name: "Pelican Bay Networks", slug: "pelican-bay", industry: "Telecom", stage: "REPLIED", by: 0, first: 10, gap: 4, pre: 2, due: 4, claim: "live", contacts: ["Ravi Subramanian, Regional Manager"] },
  { name: "Redfern Outfitters", slug: "redfern", industry: "Retail", stage: "REPLIED", by: 4, first: 24, pre: 1, due: -7, contacts: ["Tessa Ingram, Marketing Lead"], note: "Replied but nobody has answered yet. Worth picking up." },
  { name: "Glasswing Hardware", slug: "glasswing", industry: "Hardware", stage: "REPLIED", by: 2, first: 8, pre: 1, due: -1, contacts: ["Hugo Brennan, Sales Director"] },

  // In conversation.
  { name: "Cinderfall Semiconductors", slug: "cinderfall", industry: "Semiconductors", stage: "IN_CONVERSATION", by: 3, first: 34, gap: 10, pre: 3, post: 2, due: 3, claim: "live", contacts: ["Annika Solheim, Campus Programs", "Joel Barrett, Engineering Manager"] },
  { name: "Bramblewick Consulting", slug: "bramblewick", industry: "Consulting", stage: "IN_CONVERSATION", by: 1, first: 29, gap: 14, pre: 2, post: 1, due: -3, contacts: ["Winston Achebe, Principal"] },
  { name: "Hollowmere Power Systems", slug: "hollowmere", industry: "Energy", stage: "IN_CONVERSATION", by: 4, first: 22, gap: 8, pre: 2, post: 2, due: 1, claim: "live", contacts: ["Sunita Kapoor, Community Affairs"] },
  { name: "Starling Pharma Services", slug: "starling", industry: "Healthcare", stage: "IN_CONVERSATION", by: 2, first: 55, gap: 14, pre: 3, post: 2, due: -9, claim: "expired", contacts: ["Gabriel Okonkwo, Business Development"] },
  { name: "Underhill Engineering", slug: "underhill", industry: "Engineering", stage: "IN_CONVERSATION", by: 0, first: 17, gap: 9, pre: 2, post: 1, due: 0, contacts: ["Marguerite Fontaine, Principal Engineer"] },

  // Committed.
  { name: "Ambergate Packaging", slug: "ambergate", industry: "Manufacturing", stage: "COMMITTED", by: 1, first: 52, gap: 12, pre: 2, post: 2, contacts: ["Lucas Everhart, Plant Director"] },
  { name: "Juniper Row Financial", slug: "juniper-row", industry: "Finance", stage: "COMMITTED", by: 2, first: 47, gap: 15, pre: 2, post: 2, contacts: ["Imani Rousseau, Vice President"] },
  { name: "Northgrove Telehealth", slug: "northgrove", industry: "Healthcare", stage: "COMMITTED", by: 3, first: 38, gap: 9, pre: 2, post: 1, contacts: ["Dr. Priyanka Menon, Chief of Staff"] },
  { name: "Beacon Hollow Education", slug: "beacon-hollow", industry: "Education", stage: "COMMITTED", by: 0, first: 27, gap: 6, pre: 2, post: 2, contacts: ["Silas Whitaker, Program Director"] },
  { name: "Foxglove Studios", slug: "foxglove", industry: "Media", stage: "COMMITTED", by: 4, first: 20, gap: 5, pre: 2, post: 1, contacts: ["Zainab Qureshi, Creative Producer"] },

  // Declined.
  { name: "Dunmore Steelworks", slug: "dunmore", industry: "Manufacturing", stage: "DECLINED", by: 2, first: 44, gap: 10, pre: 3, contacts: ["Peter Halvorsen, Plant Manager"] },
  { name: "Everly & Wren Advisory", slug: "everly-wren", industry: "Consulting", stage: "DECLINED", by: 1, first: 31, gap: 9, pre: 2, replied: true, contacts: ["Constance Mbeki, Partner"] },
  { name: "Gilded Heron Hotels", slug: "gilded-heron", industry: "Hospitality", stage: "DECLINED", by: 3, first: 40, gap: 15, pre: 2, post: 1, replied: true, contacts: ["Rosalind Kerr, Regional Marketing"] },
  { name: "Cobalt Meadow Materials", slug: "cobalt-meadow", industry: "Materials", stage: "DECLINED", by: 4, first: 15, gap: 7, pre: 2 },
  { name: "Rookery Retail Group", slug: "rookery", industry: "Retail", stage: "DECLINED", by: 0, first: 60, gap: 20, pre: 2, replied: true, contacts: ["Desmond Achterberg, Brand Manager"] },
  { name: "Thistledown Software", slug: "thistledown", industry: "Software", stage: "DECLINED", by: 1, first: 25, gap: 12, pre: 2, contacts: ["Yuki Tanaka, Engineering Recruiter"] },
];

// What a person typed in the note field after each kind of touch.
export const NOTES = {
  intro: [
    "Intro email to {c}. Mentioned the spring showcase and the sponsor tiers.",
    "Sent the intro to {c}; asked who handles community giving.",
    "First email to {c}. Kept it to three sentences.",
    "Intro to {c}, found through the alumni mentor list.",
    "Cold intro to {c} with the one-page overview attached.",
  ],
  introLinkedin: [
    "Connection request and a short note to {c} on LinkedIn.",
    "Messaged {c} on LinkedIn; their email was not listed anywhere.",
  ],
  followUp: [
    "Gentle nudge to {c}. No answer to the first email yet.",
    "Second email to {c} with the date of the showcase.",
    "Followed up with {c} and offered a 15 minute call.",
    "Third try to {c}, shorter this time.",
  ],
  reply: [
    "{c} replied the next day and asked for the sponsor tiers.",
    "Reply from {c}: interested, needs to check with their marketing lead.",
    "{c} answered within hours and suggested a call next week.",
    "{c} replied and asked whether students could visit their office.",
  ],
  call: [
    "Call with {c}, about 20 minutes. Walked through the packages.",
    "Coffee with {c} near campus. They will take it to their team.",
    "Phone call with {c}; they liked the idea of a booth at the showcase.",
  ],
  packet: [
    "Sent {c} the sponsor packet and a thank-you note.",
    "Sent revised numbers to {c} after the call.",
    "Emailed {c} the logo and booth requirements.",
  ],
  confirm: [
    "{c} confirmed. They are in at the bronze tier, invoice to follow from the treasurer.",
    "Confirmed with {c}: they will sponsor the showcase and send their logo.",
    "{c} said yes. Booth space reserved.",
  ],
  declineReply: [
    "{c} replied: budget is set for the year. Closing this out.",
    "{c} wrote back that they only sponsor within their own region. Closing this out.",
    "{c} declined for this semester but would like to hear from us in the fall.",
  ],
  declineSilent: [
    "No answer after three tries. Closing this out.",
    "No reply to either email. Closing this out for now.",
  ],
};
