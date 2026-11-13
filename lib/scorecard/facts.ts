import {
  formatCount,
  formatPct,
  formatRange,
  MATURITY_DAYS,
  MIN_SENDS,
  TOUCH_LABELS,
  TOUCHES,
  type Rated,
  type Scorecard,
} from "@/lib/stats-math";

// The fact table behind "Explain these numbers": every number the explanation may mention, as a
// flat list of keyed facts that code builds from the scorecard (lib/stats.ts, lib/stats-math.ts).
// The model never calculates or restates a number. It writes words around fact keys, and the page
// shows each key as a chip whose text is `text`, the value formatted exactly as the stats page
// formats it. Pure: no database, no AI, so it is tested against the hand-computed stats fixture.

export type FactValue = number | string;
export type Fact = {
  key: string;
  value: FactValue;
  // The value as the stats page shows it ("49%", "12% to 31%", "1,204", "rated").
  text: string;
  // A plain label for a popover and for the model ("sends of Fall pitch that are old enough to count").
  what: string;
};
// `names` maps the template keys in the facts ("t1" ... "t8") to the templates' names.
export type FactTable = { facts: Fact[]; names: Record<string, string> };

// The templates with the most sends are explained; the rest stay on the page.
export const MAX_TEMPLATES = 8;
// What the verdict facts say when the data cannot name a template yet.
export const TOO_EARLY = "too early to tell";

const round4 = (x: number) => Math.round(x * 10_000) / 10_000;

const STATUS_TEXT: Record<Rated["status"], string> = { rated: "rated", too_few: "too few sends yet", none: "no sends yet" };

// Seven facts about one group of sends. `sends` is a plural noun phrase for the labels.
function statFacts(prefix: string, sends: string, stat: Rated): Fact[] {
  const facts: Fact[] = [
    { key: `${prefix}.sent`, value: stat.sent, text: formatCount(stat.sent), what: sends },
    { key: `${prefix}.counted`, value: stat.counted, text: formatCount(stat.counted), what: `${sends} that are old enough to count` },
    { key: `${prefix}.replies`, value: stat.replies, text: formatCount(stat.replies), what: `${sends} that count and got a reply` },
    { key: `${prefix}.maturing`, value: stat.maturing, text: formatCount(stat.maturing), what: `${sends} that are still too young to count` },
  ];
  if (stat.rate !== null) {
    facts.push({ key: `${prefix}.rate`, value: round4(stat.rate), text: formatPct(stat.rate), what: `reply rate for ${sends} (replies out of counted sends)` });
  }
  if (stat.interval) {
    facts.push({
      key: `${prefix}.range`,
      value: `${round4(stat.interval.low)} to ${round4(stat.interval.high)}`,
      text: formatRange(stat.interval),
      what: `likely range of the reply rate for ${sends} (95% interval)`,
    });
  }
  facts.push({
    key: `${prefix}.status`,
    value: stat.status,
    text: STATUS_TEXT[stat.status],
    what: `whether ${sends} have the ${MIN_SENDS} counted sends needed to be rated`,
  });
  return facts;
}

// Whether the workspace has logged any outreach at all (nothing to explain otherwise).
export const hasOutreach = (card: Scorecard): boolean => card.templates.some((t) => t.stat.sent > 0) || card.noTemplate.stat.sent > 0;

export function buildFactTable(card: Scorecard): FactTable {
  const facts: Fact[] = [];
  const names: Record<string, string> = {};
  const nameOf = (key: string | null) => card.templates.find((t) => t.key === key)?.name ?? null;

  facts.push(
    { key: "rule.minSends", value: MIN_SENDS, text: formatCount(MIN_SENDS), what: "counted sends a template needs before it is rated" },
    { key: "rule.maturityDays", value: MATURITY_DAYS, text: formatCount(MATURITY_DAYS), what: "days old a send must be before it counts" },
  );

  // The verdict is decided in code (activeVerdict, templates people can still use) and nowhere
  // else. When it cannot name a template, the fact says so in words code wrote.
  const { activeVerdict } = card;
  const best = nameOf(activeVerdict.best);
  const worst = nameOf(activeVerdict.worst);
  facts.push(
    {
      key: "verdict.best",
      value: best ?? TOO_EARLY,
      text: best ?? TOO_EARLY,
      what: best ? "the template in use whose likely range sits wholly above every other rated template in use" : "no template in use can be named best yet",
    },
    {
      key: "verdict.worst",
      value: worst ?? TOO_EARLY,
      text: worst ?? TOO_EARLY,
      what: worst ? "the template in use whose likely range sits wholly below every other rated template in use" : "no template in use can be named worst yet",
    },
    {
      key: "verdict.rated",
      value: activeVerdict.rated,
      text: formatCount(activeVerdict.rated),
      what: `templates in use that have ${MIN_SENDS} counted sends, so are rated`,
    },
  );
  if (activeVerdict.retiredBetter) {
    const { name, rate } = activeVerdict.retiredBetter;
    facts.push({
      key: "verdict.retiredBetter",
      value: name,
      text: `${name} (${formatPct(rate)})`,
      what: "a retired template that had a higher reply rate than every rated template still in use",
    });
  }

  // Templates by sends, most first (name breaks a tie), at most eight; t1 is the one with most sends.
  const shown = [...card.templates]
    .sort((a, b) => b.stat.sent - a.stat.sent || a.name.localeCompare(b.name))
    .slice(0, MAX_TEMPLATES);
  shown.forEach((t, i) => {
    const key = `t${i + 1}`;
    names[key] = t.name;
    facts.push(
      { key: `${key}.name`, value: t.name, text: t.name, what: "the name of a template" },
      { key: `${key}.inUse`, value: t.archived ? "retired" : "in use", text: t.archived ? "retired" : "in use", what: `whether people can still pick ${t.name}` },
      ...statFacts(key, `sends of ${t.name}`, t.stat),
    );
  });

  facts.push(...statFacts("noTemplate", "sends logged with no template", card.noTemplate.stat));

  // AI-drafted against hand-written, emails only, and which one leads (decided by code).
  const { authorship } = card;
  facts.push(...statFacts("ai", "AI-drafted email sends", authorship.ai), ...statFacts("hand", "hand-written email sends", authorship.hand));
  const lead = authorship.lead;
  facts.push({
    key: "authorship.lead",
    value: lead ?? "none",
    text: lead === "ai" ? "AI-drafted emails" : lead === "hand" ? "hand-written emails" : "no clear lead yet",
    what: "which kind of email gets replies more often, named only when the likely ranges do not overlap",
  });

  // The three touches, always in order.
  TOUCHES.forEach((touch, i) => {
    const part = card.byTouch.find((p) => p.label === TOUCH_LABELS[touch]);
    if (part) facts.push(...statFacts(`touch${i + 1}`, `sends that were a company's ${TOUCH_LABELS[touch]}`, part.stat));
  });

  facts.push(
    { key: "gaps.noTemplate", value: card.gaps.noTemplate, text: formatCount(card.gaps.noTemplate), what: "sends logged with no template" },
    {
      key: "gaps.repliedUnmarked",
      value: card.gaps.repliedUnmarked,
      text: formatCount(card.gaps.repliedUnmarked),
      what: "companies that replied but have no reply marked on any send, which counts as a miss for every template they got",
    },
    { key: "gaps.maturing", value: card.gaps.maturing, text: formatCount(card.gaps.maturing), what: "sends still too young to count" },
  );

  return { facts, names };
}

// Every key the model may use, for the check that it used only these.
export const factKeys = (table: FactTable): Set<string> => new Set(table.facts.map((f) => f.key));
