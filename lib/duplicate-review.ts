// The board's "Possible duplicates" sheet as plain data (components/ledger/duplicate-pairs.tsx
// shows it). The pairs come from the server (lib/company-pairs.ts listPossibleDuplicatePairs) and are
// re-sent each time an action revalidates the board, so a resolved pair is simply missing from the
// next list. To let it leave with the same motion as the import review, the list on screen keeps
// it a little longer: a pair the server dropped stays in its place, marked leaving, until its exit
// ends. Nothing here talks to the server; archiving and "separate" stay server actions with their
// own checks.

export type Keyed = { key: string };

// "Pair 2 of 5" as it read when a pair started to leave, so its label doesn't change on the way out.
export type PairSlot = { n: number; of: number };

export type PairListState<T extends Keyed> = {
  // The last list the server sent.
  source: T[];
  // What is on screen: the server's list plus pairs on their way out, each in its old place.
  shown: T[];
  leaving: ReadonlyMap<string, PairSlot>;
  // Pairs whose exit ended while the server still listed them (its fresh list is on the way).
  gone: ReadonlySet<string>;
  // Pairs that appeared after the sheet opened, so they rise in instead of popping in.
  arrived: ReadonlySet<string>;
  // How many pairs were resolved here since the sheet opened.
  resolved: number;
};

export type PairListAction<T extends Keyed> =
  // The server sent a fresh list.
  | { type: "sync"; pairs: T[] }
  // An action for this pair succeeded: start its exit.
  | { type: "resolve"; key: string }
  // Its exit ended: take it off the screen.
  | { type: "left"; key: string };

export function initialPairList<T extends Keyed>(pairs: T[]): PairListState<T> {
  return { source: pairs, shown: pairs, leaving: new Map(), gone: new Set(), arrived: new Set(), resolved: 0 };
}

// The pairs still waiting for an answer, in order.
export const openPairs = <T extends Keyed>(state: PairListState<T>): T[] => state.shown.filter((p) => !state.leaving.has(p.key));

// Where a pair sits among the open ones right now, for its label as it starts to leave.
function slotOf<T extends Keyed>(state: PairListState<T>, key: string): PairSlot {
  const open = openPairs(state);
  return { n: open.findIndex((p) => p.key === key) + 1, of: open.length };
}

// The server's new list, with every pair it dropped kept where it was on screen (after the nearest
// pair above it that is still shown), so the space closes in place instead of jumping.
export function keepLeaving<T extends Keyed>(shown: T[], next: T[]): { list: T[]; dropped: string[] } {
  const nextKeys = new Set(next.map((p) => p.key));
  const list = [...next];
  const dropped: string[] = [];
  shown.forEach((pair, i) => {
    if (nextKeys.has(pair.key)) return;
    dropped.push(pair.key);
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const above = list.findIndex((p) => p.key === shown[j].key);
      if (above !== -1) {
        at = above + 1;
        break;
      }
    }
    list.splice(at, 0, pair);
  });
  return { list, dropped };
}

export function pairListReducer<T extends Keyed>(state: PairListState<T>, action: PairListAction<T>): PairListState<T> {
  switch (action.type) {
    case "sync": {
      const nextKeys = new Set(action.pairs.map((p) => p.key));
      // A pair that already left stays off the screen while the server still lists it.
      const gone = new Set([...state.gone].filter((key) => nextKeys.has(key)));
      const fresh = action.pairs.filter((p) => !gone.has(p.key));
      const { list, dropped } = keepLeaving(state.shown, fresh);
      const leaving = new Map(state.leaving);
      for (const key of dropped) if (!leaving.has(key)) leaving.set(key, slotOf(state, key));
      const before = new Set(state.shown.map((p) => p.key));
      const arrived = new Set([...state.arrived].filter((key) => nextKeys.has(key)));
      for (const p of fresh) if (!before.has(p.key) && !state.gone.has(p.key)) arrived.add(p.key);
      return { ...state, source: action.pairs, shown: list, leaving, gone, arrived };
    }
    case "resolve": {
      if (!state.shown.some((p) => p.key === action.key)) return { ...state, resolved: state.resolved + 1 };
      const leaving = new Map(state.leaving);
      if (!leaving.has(action.key)) leaving.set(action.key, slotOf(state, action.key));
      return { ...state, leaving, resolved: state.resolved + 1 };
    }
    case "left": {
      if (!state.leaving.has(action.key)) return state;
      const leaving = new Map(state.leaving);
      leaving.delete(action.key);
      const arrived = new Set(state.arrived);
      arrived.delete(action.key);
      const gone = state.source.some((p) => p.key === action.key) ? new Set([...state.gone, action.key]) : state.gone;
      return { ...state, shown: state.shown.filter((p) => p.key !== action.key), leaving, arrived, gone };
    }
  }
}

// "Pair 2 of 5". At the server's cap there may be more than it sent.
export const pairLabel = ({ n, of }: PairSlot, more: boolean) => `Pair ${n} of ${of}${more ? "+" : ""}`;

// The margin notes after a pair is resolved. A name that ends in a period ("Inc.") ends the sentence.
const sentence = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`);
export const archivedNote = (name: string) => sentence(`Archived ${name.trim()}`);
export const separateNote = (a: string, b: string) => `Kept ${a} and ${b} as separate companies.`;
