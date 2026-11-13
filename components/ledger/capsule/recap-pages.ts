import type { Recap } from "@/lib/capsule";
import { monthName, plural, spanWords } from "./format";

// The pages of "Your year in Coppice", as plain data (components/ledger/capsule/recap-reader.tsx
// draws them). One big number or word and one line each, always saying "this year". A page whose
// figure the year doesn't have (no busiest month, no reply to time) is left out rather than shown
// empty, and a year with nothing logged is one page that says so.

export type RecapPage = {
  key: string;
  // cover and close have a stamp; the rest are one figure.
  kind: "cover" | "figure" | "close" | "empty";
  kicker: string;
  // The big serif number or word.
  value: string;
  // True when value is a word or a short phrase, set smaller than a number.
  word?: boolean;
  line: string;
};

export function recapPages(recap: Recap): RecapPage[] {
  const { team, you, year } = recap;
  if (recap.empty) {
    return [
      {
        key: "empty",
        kind: "empty",
        kicker: `Board of ${year.label}`,
        value: "Nothing yet",
        word: true,
        line: "There is nothing to look back on yet. Log some outreach and this page fills in as the year goes.",
      },
    ];
  }
  const pages: RecapPage[] = [
    { key: "cover", kind: "cover", kicker: "Your year in Coppice", value: year.label, word: true, line: "Here is what this board did this year, a page at a time." },
    { key: "contacted", kind: "figure", kicker: "The team", value: team.companiesContacted.toLocaleString("en-US"), line: `${team.companiesContacted === 1 ? "company was" : "companies were"} contacted this year.` },
    { key: "outreach", kind: "figure", kicker: "The team", value: team.outreachLogged.toLocaleString("en-US"), line: `${team.outreachLogged === 1 ? "outreach entry was" : "outreach entries were"} logged this year.` },
    { key: "replies", kind: "figure", kicker: "The team", value: team.repliesMarked.toLocaleString("en-US"), line: `${team.repliesMarked === 1 ? "reply was" : "replies were"} marked this year.` },
    {
      key: "committed",
      kind: "figure",
      kicker: "The team",
      value: team.companiesCommitted.toLocaleString("en-US"),
      line: `${team.companiesCommitted === 1 ? "company" : "companies"} moved to Committed this year.`,
    },
  ];
  const month = team.busiestMonth ? monthName(team.busiestMonth.month) : null;
  if (team.busiestMonth && month) {
    pages.push({ key: "busiest", kind: "figure", kicker: "The busiest month", value: month, word: true, line: `${plural(team.busiestMonth.count, "outreach entry", "outreach entries")} went out in ${month} this year, more than in any other month.` });
  }
  if (team.longestThread) {
    pages.push({
      key: "longest",
      kind: "figure",
      kicker: "The longest thread",
      value: team.longestThread.count.toLocaleString("en-US"),
      line: `${team.longestThread.name} got the most outreach this year: ${plural(team.longestThread.count, "entry", "entries")}.`,
    });
  }
  if (team.fastestReply) {
    const { value, unit } = spanWords(team.fastestReply.ms);
    pages.push({ key: "fastest", kind: "figure", kicker: "The fastest reply", value: `${value} ${value === 1 ? unit : `${unit}s`}`, word: true, line: `after our outreach, ${team.fastestReply.name} moved to Replied. That was the fastest this year.` });
  }
  pages.push(
    team.bestTemplate
      ? {
          key: "template",
          kind: "figure",
          kicker: "The best template",
          value: `${Math.round(team.bestTemplate.rate * 100)}%`,
          line: `${team.bestTemplate.name} got a reply on ${Math.round(team.bestTemplate.rate * 100)}% of its counted sends this year.`,
        }
      : {
          key: "template",
          kind: "figure",
          kicker: "The best template",
          value: "Too early",
          word: true,
          line: "to say which template is best this year. Template stats names one once the numbers can tell them apart.",
        },
  );
  pages.push(
    { key: "you-logged", kind: "figure", kicker: "You", value: you.outreachLogged.toLocaleString("en-US"), line: `${you.outreachLogged === 1 ? "outreach entry was" : "outreach entries were"} logged by you this year.` },
    { key: "you-replies", kind: "figure", kicker: "You", value: you.repliesOnYours.toLocaleString("en-US"), line: `${you.repliesOnYours === 1 ? "reply was" : "replies were"} marked on your outreach this year.` },
    { key: "you-committed", kind: "figure", kicker: "You", value: you.committed.toLocaleString("en-US"), line: `${you.committed === 1 ? "company" : "companies"} you moved to Committed this year.` },
    { key: "you-holding", kind: "figure", kicker: "You", value: you.holding.toLocaleString("en-US"), line: `${you.holding === 1 ? "company is" : "companies are"} yours to work right now.` },
    { key: "close", kind: "close", kicker: `Board of ${year.label}`, value: "That is the year", word: true, line: "Thank you for working the list. Everything the next board needs can be handed on below." },
  );
  return pages;
}
