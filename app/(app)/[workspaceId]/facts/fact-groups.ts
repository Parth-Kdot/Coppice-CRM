// The fact sheet lists facts under the page of the packet they came from ("Page 2"), in page
// order, with facts typed by hand last under "Added by hand". With more than one packet the
// heading names the file too ("Page 2 of packet.pdf"). Pure, so the client list can regroup while
// a fact is on its way from one section to the other (tests/fact-groups.test.ts).

export type Groupable = { id: string; fromPdf: boolean; pageNumber: number | null; fileName: string | null };
export type FactGroup<T extends Groupable> = { key: string; title: string; facts: T[] };

const HAND = "hand";

export function groupByPage<T extends Groupable>(facts: T[], showFile: boolean): FactGroup<T>[] {
  const groups = new Map<string, FactGroup<T> & { page: number; order: number }>();
  for (const fact of facts) {
    let key = HAND;
    let title = "Added by hand";
    let page = Number.POSITIVE_INFINITY;
    if (fact.fromPdf) {
      const file = fact.fileName ?? "a deleted file";
      const of = showFile ? ` of ${file}` : "";
      page = fact.pageNumber && fact.pageNumber > 0 ? fact.pageNumber : 1e6;
      key = `p${page === 1e6 ? 0 : page}:${file}`;
      title = page === 1e6 ? `Page unknown${of}` : `Page ${page}${of}`;
    }
    const group = groups.get(key) ?? { key, title, facts: [], page, order: groups.size };
    group.facts.push(fact);
    groups.set(key, group);
  }
  // Page order; the same page of two files keeps the order the files first appear in.
  return [...groups.values()].sort((a, b) => a.page - b.page || a.order - b.order).map(({ key, title, facts: list }) => ({ key, title, facts: list }));
}

// The bulk button's label, for `quoted` facts with their quote found out of `waiting`:
// "Verify 1 with its quote found", "Verify all 4", "Verify 3 with quotes found".
export function verifyAllLabel(quoted: number, waiting: number): string {
  if (quoted === 1) return "Verify 1 with its quote found";
  return quoted === waiting ? `Verify all ${quoted}` : `Verify ${quoted} with quotes found`;
}
