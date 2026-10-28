import { daysOverdue } from "@/demo/dates";
import { claimStateOf } from "@/demo/rules";
import { claimView, type ClaimView } from "@/demo/selectors";
import { STAGES, STAGE_LABELS, isTerminalStage, type Company, type Contact, type DemoState, type Role, type Stage } from "@/demo/types";

// What the command palette finds. Pure functions of the demo state, so they can be tested without a
// browser. Results come in three groups: Companies, People (the contacts at those companies) and
// Actions. Companies and people say what they matched on ("matched on contact: dana@kestrel.com").

export type PaletteTarget =
  | { type: "go"; href: string }
  | { type: "claim"; companyId: string; name: string }
  | { type: "log"; companyId: string }
  | { type: "move"; companyId: string; name: string; to: Stage }
  | { type: "role"; role: Role }
  | { type: "reset" };

export type PaletteItem =
  | { kind: "company"; key: string; company: Company; claim: ClaimView; days: number | null; dueOn: string | null; matched: string | null; href: string }
  | { kind: "person"; key: string; contact: Contact; company: Company; matched: string; href: string }
  | { kind: "action"; key: string; label: string; hint: string; target: PaletteTarget };

export type PaletteGroup = { id: "companies" | "people" | "actions"; title: string; items: PaletteItem[] };

export type PaletteRoutes = {
  queue: string;
  board: string;
  companies: string;
  newCompany: string;
  import: string;
  facts: string;
  settings: string;
  company: (companyId: string, anchor?: "logOutreach") => string;
};

const LIMITS = { companies: 6, people: 4, actions: 8 } as const;

const MONTH_DAY = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = (iso: string) => {
  const [, month, day] = iso.slice(0, 10).split("-").map(Number);
  return `${MONTH_DAY[month - 1]} ${day}`;
};

type CompanyMatch = { rank: number; matched: string };

// How a company matches the text: name first (starts-with ranks above contains), then website,
// industry, a contact's name or email, and notes.
function matchCompany(company: Company, contacts: Contact[], q: string): CompanyMatch | null {
  const name = company.name.toLowerCase();
  if (name.startsWith(q)) return { rank: 0, matched: "matched on name" };
  if (name.includes(q)) return { rank: 1, matched: "matched on name" };
  if (company.website?.toLowerCase().includes(q)) return { rank: 2, matched: `matched on website: ${company.website}` };
  if (company.industry?.toLowerCase().includes(q)) return { rank: 3, matched: `matched on industry: ${company.industry}` };
  const byEmail = contacts.find((c) => c.email?.toLowerCase().includes(q));
  if (byEmail) return { rank: 4, matched: `matched on contact: ${byEmail.email}` };
  const byName = contacts.find((c) => c.name.toLowerCase().includes(q));
  if (byName) return { rank: 4, matched: `matched on contact: ${byName.name}` };
  if (company.notes?.toLowerCase().includes(q)) return { rank: 5, matched: "matched on note" };
  return null;
}

function matchContact(contact: Contact, q: string): CompanyMatch | null {
  const name = contact.name.toLowerCase();
  if (name.startsWith(q) || name.split(/\s+/).some((w) => w.startsWith(q))) return { rank: 0, matched: "matched on name" };
  if (name.includes(q)) return { rank: 1, matched: "matched on name" };
  if (contact.email?.toLowerCase().includes(q)) return { rank: 2, matched: `matched on email: ${contact.email}` };
  if (contact.title?.toLowerCase().includes(q)) return { rank: 3, matched: `matched on title: ${contact.title}` };
  return null;
}

const STAGE_WORDS = ["contacted", "replied", "conversation", "committed", "declined", "stage"];
const VERB_WORDS = new Set(["claim", "log", "outreach", "move", "on", "to", "go", "add", "new", "open"]);

export function searchPalette(state: DemoState, ws: string, query: string, routes: PaletteRoutes, role: Role | null): PaletteGroup[] {
  const q = query.trim().toLowerCase();
  const tokens = q.split(/\s+/).filter(Boolean);
  // The words that name a company or a person: what is left after the verbs ("claim lilly" finds Lilly).
  const wantsMove = tokens.includes("move") || tokens.some((t) => t.length >= 4 && STAGE_WORDS.some((w) => w.startsWith(t)));
  const subject = tokens.filter((t) => !VERB_WORDS.has(t) && !(wantsMove && t.length >= 4 && STAGE_WORDS.some((w) => w.startsWith(t)))).join(" ");
  const companies = state.companies.filter((c) => c.workspaceId === ws && c.archivedAt === null);
  const contacts = state.contacts.filter((c) => c.workspaceId === ws);
  const contactsOf = new Map<string, Contact[]>();
  for (const c of contacts) contactsOf.set(c.companyId, [...(contactsOf.get(c.companyId) ?? []), c]);
  const byName = (a: Company, b: Company) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

  const companyItem = (company: Company, matched: string | null): PaletteItem => ({
    kind: "company",
    key: `company-${company.id}`,
    company,
    claim: claimView(state, company),
    days: company.nextFollowUpAt ? daysOverdue(company.nextFollowUpAt, state.now) : null,
    dueOn: company.nextFollowUpAt ? shortDate(company.nextFollowUpAt) : null,
    matched,
    href: routes.company(company.id),
  });

  // ----- Companies -----
  let companyHits: PaletteItem[];
  let matchedCompanies: Company[];
  if (!q || !subject) {
    if (q) {
      matchedCompanies = [];
      companyHits = [];
    } else {
      // With nothing typed: the follow-ups that most need someone.
      matchedCompanies = companies
        .filter((c) => !isTerminalStage(c.stage) && c.nextFollowUpAt !== null && Date.parse(c.nextFollowUpAt) <= Date.parse(state.now))
        .sort((a, b) => Date.parse(a.nextFollowUpAt as string) - Date.parse(b.nextFollowUpAt as string) || byName(a, b))
        .slice(0, 4);
      companyHits = matchedCompanies.map((c) => companyItem(c, null));
    }
  } else {
    const hits = companies
      .map((c) => ({ c, m: matchCompany(c, contactsOf.get(c.id) ?? [], subject) }))
      .filter((h): h is { c: Company; m: CompanyMatch } => h.m !== null)
      .sort((a, b) => a.m.rank - b.m.rank || byName(a.c, b.c))
      .slice(0, LIMITS.companies);
    matchedCompanies = hits.map((h) => h.c);
    companyHits = hits.map((h) => companyItem(h.c, h.m.matched));
  }

  // ----- People -----
  const people: PaletteItem[] = subject
    ? contacts
        .map((contact) => ({ contact, m: matchContact(contact, subject) }))
        .filter((h): h is { contact: Contact; m: CompanyMatch } => h.m !== null)
        .sort((a, b) => a.m.rank - b.m.rank || a.contact.name.localeCompare(b.contact.name))
        .flatMap(({ contact, m }) => {
          const company = companies.find((c) => c.id === contact.companyId);
          return company
            ? [{ kind: "person" as const, key: `person-${contact.id}`, contact, company, matched: m.matched, href: routes.company(company.id) }]
            : [];
        })
        .slice(0, LIMITS.people)
    : [];

  // ----- Actions -----
  const action = (key: string, label: string, hint: string, target: PaletteTarget): PaletteItem => ({ kind: "action", key, label, hint, target });
  const all: { item: PaletteItem; order: number }[] = [];
  const add = (order: number, item: PaletteItem) => all.push({ item, order });

  // Actions on the companies the text found. Claim and Log outreach appear for any search; Move only
  // when the text asks for it ("move lilly", "contacted").
  for (const company of matchedCompanies.slice(0, 3)) {
    if (!q) break;
    const cs = claimStateOf(company, state.now, state.meId);
    const closed = isTerminalStage(company.stage);
    if (!closed && (cs === "free" || cs === "expired"))
      add(
        0,
        action(`claim-${company.id}`, `Claim ${company.name}`, "Hold it for the claim window", { type: "claim", companyId: company.id, name: company.name }),
      );
    if (!closed && cs === "mine")
      add(0, action(`log-${company.id}`, `Log outreach on ${company.name}`, "Opens the log form", { type: "log", companyId: company.id }));
    if (wantsMove) {
      for (const stage of STAGES) {
        if (stage === company.stage) continue;
        add(
          1,
          action(`move-${company.id}-${stage}`, `Move ${company.name} to ${STAGE_LABELS[stage]}`, "Change its stage", {
            type: "move",
            companyId: company.id,
            name: company.name,
            to: stage,
          }),
        );
      }
    }
  }

  const go = (key: string, label: string, href: string, hint = "Go to") => action(key, label, hint, { type: "go", href });
  add(2, go("go-queue", "Go to Queue", routes.queue));
  add(2, go("go-board", "Go to Board", routes.board));
  add(2, go("go-companies", "Go to Companies", routes.companies));
  add(2, go("go-import", "Go to Import", routes.import));
  add(2, go("go-facts", "Go to Facts", routes.facts));
  add(2, go("go-settings", "Go to Settings", routes.settings));
  add(2, go("new-company", "Add a new company", routes.newCompany, "Opens the form"));
  if (role) {
    const other: Role = role === "owner" ? "member" : "owner";
    add(3, action("switch-role", other === "owner" ? "Switch to Owner view" : "Switch to Officer view", "Demo", { type: "role", role: other }));
  }
  add(3, action("reset", "Reset demo", "Demo", { type: "reset" }));

  const actionHits = all
    .filter(({ item }) => item.kind !== "action" || tokens.every((t) => item.label.toLowerCase().includes(t)))
    // A search ranks the actions on the companies it found first; an empty box keeps the list as written.
    .sort((a, b) => (q ? a.order - b.order : 0))
    .map(({ item }) => item)
    .slice(0, q ? LIMITS.actions : 10);

  const groups: PaletteGroup[] = [
    { id: "companies", title: "Companies", items: companyHits },
    { id: "people", title: "People", items: people },
    { id: "actions", title: "Actions", items: actionHits },
  ];
  // Typing a command ("claim lilly", "move lilly replied") puts the actions first, so Enter runs it.
  if (tokens.some((t) => t === "claim" || t === "log" || t === "move")) groups.unshift(...groups.splice(2, 1));
  return groups.filter((g) => g.items.length > 0);
}
