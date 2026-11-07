"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { focusSoon } from "@/components/ledger/focus";
import { completeStamp, preloadMotion, prefersReducedMotion, pulse, removeAway, restore, sendTo, withinReach } from "@/components/ledger/motion-kit";
import { useConfirm, useNotify } from "@/components/ledger/providers";
import type { ActionResult } from "@/lib/validation";
import { groupByPage, verifyAllLabel } from "./fact-groups";
import { FactRow, factDomId, type FactHandlers, type FactView } from "./fact-item";

// The owner's fact sheet: "Waiting for your check" and "Verified", each grouped by page. The board
// runs every action on a fact together with its move, so finishing one feels like something:
//   Verify          the fact is stamped (a check settles into its mark) and filed under "Verified".
//   Unverify        it is filed back under "Waiting for your check".
//   Edit and save   stamped where it is, or filed in the other section when saving moved it.
//   Delete          it slides away and its space closes.
//   Verify all      every fact with its quote found is stamped in a quick stagger, then filed.
// Filing flies the fact to the other section's count only when that count is on screen and near
// (withinReach); otherwise the fact slides off to the right in place and the count pulses when it
// next comes into view, so nothing flies off the edge of the screen. Verify all always files in
// place. A page group whose last fact leaves goes with it, heading and all. The flight is clipped to
// its panel's width (.lg-factpanel), so it never crosses the sidebar.
// The server is called at the same time as the move. While a move plays the lists are held as they
// were (`frozen`), so the server's fresh render can't pull a row out from under its animation; once
// every move is done the lists follow the server again. Reduced motion: no moves, same results.

type Action<T = undefined> = (prev: ActionResult<T> | null, form: FormData) => Promise<ActionResult<T>>;

const HEADINGS = { waiting: "facts-waiting-h", verified: "facts-verified-h" } as const;
const COUNTS = { waiting: "facts-waiting-count", verified: "facts-verified-count" } as const;
const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function call<T>(action: Action<T>, fields: Record<string, string>): Promise<ActionResult<T>> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  try {
    return await action(null, form);
  } catch {
    return { ok: false, error: "Couldn't reach the server. Check your connection and try again." };
  }
}

// Where focus goes when `row` leaves its section: the next fact still there, else the one before,
// else the heading of the section it is going to.
function neighbour(row: HTMLElement, fallback: string): HTMLElement | null {
  const section = row.closest("section.lg-panel");
  const rows = section ? [...section.querySelectorAll<HTMLElement>(".lg-fact:not([data-leaving])")] : [];
  const i = rows.indexOf(row);
  const others = rows.filter((r) => r !== row);
  return (i >= 0 ? (others[i] ?? others[i - 1]) : null) ?? document.getElementById(fallback);
}

// After a row has left: if focus fell to the page (or stayed in the row), put it on `next`.
function keepFocus(row: HTMLElement, next: HTMLElement | null) {
  const a = document.activeElement;
  if (next && (!a || a === document.body || row.contains(a))) focusSoon(next);
}

// The count beside the other section's heading, which answers when a fact lands on it.
const target = (to: keyof typeof COUNTS) => document.getElementById(COUNTS[to]) ?? document.getElementById(HEADINGS[to]);
const markOf = (row: HTMLElement) => row.querySelector(".lg-factmark svg");

// The page group `row` is in, when every fact in it is now leaving (so the group goes too).
function emptiedGroup(row: HTMLElement): HTMLElement | null {
  const group = row.closest<HTMLElement>(".lg-factgroup");
  return group && [...group.querySelectorAll(".lg-fact")].every((r) => r.hasAttribute("data-leaving")) ? group : null;
}

const near = (row: HTMLElement, to: HTMLElement | null) =>
  !!to && withinReach(row.getBoundingClientRect(), to.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight });
const onScreen = (el: HTMLElement) => near(el, el);

// A count that went up while it was off screen answers once it is seen (given up after a while).
function pulseWhenSeen(el: HTMLElement | null) {
  if (!el || prefersReducedMotion() || typeof IntersectionObserver === "undefined") return;
  const observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      observer.disconnect();
      window.clearTimeout(stop);
      void pulse(el);
    },
    { threshold: 1 },
  );
  const stop = window.setTimeout(() => observer.disconnect(), 20000);
  observer.observe(el);
}

// Files a fact that has been marked leaving: a flight to `to` when it is near, else a slide away in
// place (its page group with it when it was the group's last fact) and a pulse on `to` once seen.
async function file(row: HTMLElement, to: HTMLElement | null, next: HTMLElement | null) {
  const group = emptiedGroup(row);
  if (near(row, to)) {
    const heading = group?.querySelector<HTMLElement>(".lg-factgroup-h");
    await Promise.all([sendTo(row, to, { focus: next }), heading ? removeAway(heading, { direction: "right", distance: 12 }) : undefined]);
    return;
  }
  await removeAway(group ?? row, { direction: "right", focus: next });
  pulseWhenSeen(to);
}

export function FactBoard({
  workspaceId,
  facts,
  showFile,
  setVerified,
  remove,
  update,
  verifyQuoted,
  addSlot,
}: {
  workspaceId: string;
  facts: FactView[];
  showFile: boolean;
  setVerified: Action;
  remove: Action;
  update: Action<{ verified: boolean }>;
  verifyQuoted: Action;
  // "Add a fact", rendered by the page under the verified list.
  addSlot: ReactNode;
}) {
  const notify = useNotify();
  const confirm = useConfirm();
  const [frozen, setFrozen] = useState<FactView[] | null>(null);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [bulk, setBulk] = useState(false);
  const shown = frozen ?? facts;

  // Holding the lists while moves play.
  const ops = useRef(0);
  const frozenFrom = useRef<FactView[] | null>(null);
  const latest = useRef(facts);
  const awaitingProps = useRef(false);
  const timer = useRef<number | undefined>(undefined);

  const unfreeze = () => {
    if (ops.current > 0) return;
    window.clearTimeout(timer.current);
    awaitingProps.current = false;
    frozenFrom.current = null;
    setFrozen(null);
  };
  useEffect(() => {
    latest.current = facts;
    if (awaitingProps.current && facts !== frozenFrom.current) unfreeze();
  }, [facts]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  // Most clicks here finish something: once the pointer or focus reaches one of the board's
  // buttons, start loading the motion library, so it is ready for the click (never on page load,
  // never under reduced motion).
  const warmed = useRef(false);
  const warm = (event: { target: EventTarget | null }) => {
    if (warmed.current || !(event.target instanceof Element) || !event.target.closest("button")) return;
    warmed.current = true;
    if (!prefersReducedMotion()) preloadMotion();
  };

  const begin = (ids: string[]) => {
    if (ops.current++ === 0 && !frozenFrom.current) {
      frozenFrom.current = latest.current;
      setFrozen(latest.current);
    }
    window.clearTimeout(timer.current);
    awaitingProps.current = false;
    setBusy((b) => new Set([...b, ...ids]));
  };
  const end = (ids: string[]) => {
    setBusy((b) => new Set([...b].filter((id) => !ids.includes(id))));
    if (--ops.current > 0) return;
    // The server's render for these changes may still be on its way: wait for it (briefly).
    if (latest.current !== frozenFrom.current) return unfreeze();
    awaitingProps.current = true;
    timer.current = window.setTimeout(unfreeze, 1500);
  };
  const patch = (id: string, changes: Partial<FactView>) => setFrozen((list) => list?.map((f) => (f.id === id ? { ...f, ...changes } : f)) ?? list);

  const leave = (row: HTMLElement) => row.setAttribute("data-leaving", "");
  const stay = (row: HTMLElement) => {
    restore(row);
    const group = row.closest(".lg-factgroup");
    restore(group);
    restore(group?.querySelector(".lg-factgroup-h"));
    row.removeAttribute("data-leaving");
    row.removeAttribute("data-stamped");
  };
  const stamp = (row: HTMLElement) => {
    row.setAttribute("data-stamped", "");
    return completeStamp(row, { mark: markOf(row) });
  };

  const handlers: FactHandlers = {
    async verify(fact, row) {
      begin([fact.id]);
      const request = call(setVerified, { workspaceId, factId: fact.id, verified: "1" });
      await stamp(row);
      const result = await request;
      if (!result.ok) {
        stay(row);
        notify(result.error, "error");
      } else {
        const next = neighbour(row, HEADINGS.verified);
        const to = target("verified");
        leave(row);
        await file(row, to, next);
        keepFocus(row, next);
        notify("Fact verified.", "ok", { avoid: to });
      }
      end([fact.id]);
    },
    async unverify(fact, row) {
      begin([fact.id]);
      const next = neighbour(row, HEADINGS.verified);
      leave(row);
      const going = file(row, target("waiting"), next);
      const result = await call(setVerified, { workspaceId, factId: fact.id, verified: "0" });
      if (!result.ok) {
        stay(row);
        notify(result.error, "error");
      } else {
        await going;
        keepFocus(row, next);
        notify("Fact unverified. Drafts stop using it.");
      }
      end([fact.id]);
    },
    async remove(fact, row) {
      const ok = await confirm({ message: "Delete this fact?", confirmLabel: "Delete" });
      if (!ok) return;
      begin([fact.id]);
      const next = neighbour(row, fact.verified ? HEADINGS.verified : HEADINGS.waiting);
      leave(row);
      const going = removeAway(emptiedGroup(row) ?? row, { focus: next });
      const result = await call(remove, { workspaceId, factId: fact.id });
      if (!result.ok) {
        stay(row);
        notify(result.error, "error");
      } else {
        await going;
        keepFocus(row, next);
        notify("Fact deleted.");
      }
      end([fact.id]);
    },
    async save(fact, row, text, closed) {
      begin([fact.id]);
      const result = await call(update, { workspaceId, factId: fact.id, text });
      if (!result.ok) {
        end([fact.id]);
        return result;
      }
      patch(fact.id, { text });
      closed();
      await frame();
      const verified = result.data.verified;
      if (verified && fact.verified) {
        await stamp(row);
        row.removeAttribute("data-stamped");
        notify("Fact saved.");
      } else if (verified) {
        await stamp(row);
        const next = neighbour(row, HEADINGS.verified);
        const to = target("verified");
        leave(row);
        await file(row, to, next);
        keepFocus(row, next);
        notify("Saved and verified.", "ok", { avoid: to });
      } else if (fact.verified) {
        const next = neighbour(row, HEADINGS.waiting);
        leave(row);
        await file(row, target("waiting"), next);
        keepFocus(row, next);
        notify("Saved, not verified: the quote no longer supports this. Verify anyway or add it as a hand-written fact.");
      } else {
        notify("Saved. Its quote doesn't support it yet, so it still waits for your check.");
      }
      end([fact.id]);
      return result;
    },
  };

  const waiting = shown.filter((f) => !f.verified);
  const verified = shown.filter((f) => f.verified);
  const quoted = waiting.filter((f) => f.fromPdf && f.quoteFound && !f.masked);

  const verifyAll = async () => {
    if (bulk || quoted.length === 0) return;
    const ids = quoted.map((f) => f.id);
    const rows = ids.map((id) => document.getElementById(factDomId(id))).filter((el): el is HTMLElement => el !== null);
    const stayingBehind = waiting.find((f) => !ids.includes(f.id));
    setBulk(true);
    begin(ids);
    const request = call(verifyQuoted, { workspaceId });
    const still = prefersReducedMotion();
    // A quick stagger, the whole run under about half a second however long the list.
    const step = still ? 0 : Math.min(60, 480 / rows.length);
    await Promise.all(rows.map((row, i) => (step ? wait(i * step) : Promise.resolve()).then(() => stamp(row))));
    const result = await request;
    if (!result.ok) {
      rows.forEach(stay);
      notify(result.error, "error");
    } else {
      rows.forEach(leave);
      const to = target("verified");
      // Filed in place, a page group at a time where every fact in it goes, in a quick stagger.
      const leaving = [...new Set(rows.map((row) => emptiedGroup(row) ?? row))];
      const filing = Math.min(30, 240 / leaving.length);
      await Promise.all(leaving.map((el, i) => (step ? wait(i * filing) : Promise.resolve()).then(() => removeAway(el, { direction: "right" }))));
      if (to && onScreen(to)) void pulse(to);
      else pulseWhenSeen(to);
      notify(`${plural(rows.length, "fact", "facts")} verified.`, "ok", { avoid: to });
      focusSoon(stayingBehind ? `#${factDomId(stayingBehind.id)}` : `#${HEADINGS.verified}`);
    }
    end(ids);
    setBulk(false);
  };

  const list = (items: FactView[]) =>
    groupByPage(items, showFile).map((group) => (
      <section key={group.key} className="lg-factgroup" aria-label={group.title}>
        <h3 className="lg-factgroup-h lg-tag">{group.title}</h3>
        <ul className="lg-facts-list">
          {group.facts.map((fact) => (
            <FactRow key={fact.id} fact={fact} busy={busy.has(fact.id)} handlers={handlers} />
          ))}
        </ul>
      </section>
    ));

  return (
    <>
      {waiting.length > 0 && (
        <section
          className="lg-panel lg-factpanel"
          aria-labelledby={HEADINGS.waiting}
          id="facts-waiting"
          data-count={waiting.length}
          onPointerOver={warm}
          onFocus={warm}
        >
          <div className="lg-panel-head">
            <h2 id={HEADINGS.waiting} className="lg-panel-title" tabIndex={-1}>
              Waiting for your check{" "}
              <span id={COUNTS.waiting} className="lg-panel-count">
                {waiting.length}
              </span>
            </h2>
            {quoted.length > 0 && (
              <button type="button" className="lg-btn lg-btn-sm lg-btn-primary" data-tour="facts-verify-all" onClick={verifyAll} disabled={bulk}>
                {bulk ? "Working..." : verifyAllLabel(quoted.length, waiting.length)}
              </button>
            )}
          </div>
          <div className="lg-panel-body">{list(waiting)}</div>
        </section>
      )}

      <section className="lg-panel lg-factpanel" aria-labelledby={HEADINGS.verified} data-quiet="" onPointerOver={warm} onFocus={warm}>
        <div className="lg-panel-head">
          <h2 id={HEADINGS.verified} className="lg-panel-title" tabIndex={-1}>
            Verified{" "}
            <span id={COUNTS.verified} className="lg-panel-count">
              {verified.length}
            </span>
          </h2>
          <span className="lg-panel-aside">The drafter can use these.</span>
        </div>
        <div className="lg-panel-body">
          {verified.length === 0 ? <p className="lg-muted">None yet. Drafts say nothing about your org until you verify a fact.</p> : list(verified)}
          {addSlot}
        </div>
      </section>
    </>
  );
}
