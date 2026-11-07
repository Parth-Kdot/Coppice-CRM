"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useActionState, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { claimCompany } from "@/app/(app)/[workspaceId]/companies/actions";
import { loadFreshLeads, type FreshRow } from "@/app/(app)/[workspaceId]/queue-actions";
import type { ActionResult } from "@/lib/validation";
import { ClaimChip, type ClaimView } from "./claim-chip";
import { Disclosure } from "./disclosure";
import { focusSoon } from "./focus";
import { ChevronRightIcon, WarningIcon } from "./icons";
import { isLongOverdue, OverdueMark } from "./overdue";
import { useNotify } from "./providers";
import "./queue.css";

// One queue row, a single ruled line: how late, the company, the latest note (wide screens only)
// and exactly one thing to do in the same right-hand slot:
//   yours    "Log outreach" (a row you hold needs no chip; when the claim ends is in the tooltip)
//   grabs    "Claim", which becomes "Log outreach" in the same slot once it is yours, with focus
//            moved to it so a keyboard user carries straight on
//   held     the holder's chip, read only ("Priya N."); the claim's end is in its tooltip
//   fresh    a never-contacted lead: name, industry and Claim
// A refusal (someone claimed first) is written under the row and the page is refreshed, so the row
// shows the winner's chip instead of a Claim button that would only fail again. Refusals are kept
// in QueueProvider by company id, so the note follows the row into "Held by others".

export type QueueRowData = {
  id: string;
  name: string;
  // Calendar days past the follow-up date (negative: still ahead), or null for a fresh lead.
  days: number | null;
  // "Nov 2", the follow-up date, or null.
  dueOn: string | null;
  note: string | null;
  industry?: string | null;
  claim: ClaimView;
};

export type RowVariant = "yours" | "grabs" | "held" | "fresh";

// ----- Refusals, kept by company id for the whole queue -----

// Also the company whose "Log outreach" should take focus once it is drawn (a claim just succeeded):
// a ref, not state, read by whichever row with that id mounts or turns into "yours" next.
type Refusals = {
  get: (id: string) => string | undefined;
  set: (id: string, error: string | null) => void;
  any: (ids: string[]) => boolean;
  wantFocus: (id: string) => void;
  // True once, for the row asked for.
  takeFocus: (id: string) => boolean;
};
const RefusalContext = createContext<Refusals>({ get: () => undefined, set: () => undefined, any: () => false, wantFocus: () => undefined, takeFocus: () => false });

export function QueueProvider({ children }: { children: ReactNode }) {
  const [map, setMap] = useState<Record<string, string>>({});
  const focusLog = useRef<string | null>(null);
  const wantFocus = useCallback((id: string) => {
    focusLog.current = id;
  }, []);
  const takeFocus = useCallback((id: string) => {
    if (focusLog.current !== id) return false;
    focusLog.current = null;
    return true;
  }, []);
  const set = useCallback((id: string, error: string | null) => {
    setMap((current) => {
      const next = { ...current };
      if (error === null) delete next[id];
      else next[id] = error;
      return next;
    });
  }, []);
  const api = useMemo<Refusals>(() => ({ get: (id) => map[id], set, any: (ids) => ids.some((id) => id in map), wantFocus, takeFocus }), [map, set, wantFocus, takeFocus]);
  return <RefusalContext value={api}>{children}</RefusalContext>;
}

// The refusal under a row. It takes focus when it appears where focus was lost (the Claim button
// it replaced has left the page), so a keyboard user hears it and stays in the row.
function RefusalNote({ id, error, onDismiss }: { id: string; error: string; onDismiss: () => void }) {
  const note = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body) note.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div ref={note} className="lg-rownote" role="alert" tabIndex={-1} data-refusal-for={id}>
      <WarningIcon size={16} />
      <span className="lg-wrap-any">{error}</span>
      <button type="button" className="lg-btn lg-btn-quiet lg-btn-sm" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}

export function QueueRow({ workspaceId, row, variant, windowDays }: { workspaceId: string; row: QueueRowData; variant: RowVariant; windowDays?: number }) {
  const notify = useNotify();
  const router = useRouter();
  const refusals = useContext(RefusalContext);
  const href = `/${workspaceId}/companies/${row.id}`;
  const companyLink = useRef<HTMLAnchorElement>(null);

  // The claim runs through the real action. What happens next is decided when it returns (not in
  // an effect), because a successful claim moves the row from "Up for grabs" to "Yours" and this
  // component is gone by the time an effect would run.
  const [state, formAction, pending] = useActionState(async (prev: ActionResult | null, data: FormData) => {
    const result = await claimCompany(prev, data);
    if (result.ok) {
      refusals.set(row.id, null);
      notify(`Claimed ${row.name}.`);
      // The "Log outreach" link in the same slot: in the Yours group once the page refreshes, or in
      // this row (a fresh lead stays where it is). The row that draws it takes focus (effect below).
      refusals.wantFocus(row.id);
    } else {
      refusals.set(row.id, result.error);
      // Someone else won: redraw the queue so the row carries their chip, not a dead Claim button.
      router.refresh();
    }
    return result;
  }, null);

  const refused = refusals.get(row.id);
  const claimedHere = state?.ok === true;
  const mine = variant === "yours" || claimedHere || row.claim.state === "mine";
  const until = row.claim.until;
  const logLink = useRef<HTMLAnchorElement>(null);

  // Focus moves to "Log outreach" when this row is the one just claimed, unless the person has
  // already moved on (focus is somewhere other than <body> or this row).
  const { takeFocus, wantFocus } = refusals;
  useEffect(() => {
    const link = logLink.current;
    if (!mine || !link || !takeFocus(row.id)) return;
    const active = document.activeElement;
    const item = link.closest("li");
    if (active && active !== document.body && !item?.contains(active)) return;
    focusSoon(link);
    // This row may be replaced by its copy in the Yours group a moment later: if it leaves the page
    // while focus is lost, hand the focus on to that copy (cleanups run before the new row's effect).
    return () => {
      if (!link.isConnected && (!document.activeElement || document.activeElement === document.body)) wantFocus(row.id);
    };
  }, [mine, row.id, takeFocus, wantFocus]);

  let action: ReactNode;
  if (mine) {
    action = (
      <Link
        ref={logLink}
        href={`${href}#log-outreach`}
        className="lg-btn lg-btn-sm lg-qlog"
        data-log-for={row.id}
        data-tour="queue-log"
        title={until && !claimedHere ? `Yours until ${until}` : undefined}
      >
        Log outreach
        <span className="lg-sr">
          {" "}
          for {row.name}
          {until && !claimedHere ? `, yours until ${until}` : ""}
        </span>
      </Link>
    );
  } else if (row.claim.state === "theirs") {
    action = <ClaimChip claim={row.claim} companyName={row.name} />;
  } else if (refused) {
    // Lost the race and the refreshed row has not arrived yet: nothing to press.
    action = (
      <span className="lg-claimchip" data-kind="theirs">
        <span className="lg-chipbody lg-chip-theirs">Taken</span>
      </span>
    );
  } else {
    action = (
      <form action={formAction} className="lg-qclaim">
        <input type="hidden" name="workspaceId" value={workspaceId} />
        <input type="hidden" name="companyId" value={row.id} />
        <ClaimChip claim={row.claim} companyName={row.name} pending={pending} windowDays={windowDays} dataTour="queue-claim" />
      </form>
    );
  }

  return (
    <li
      className="lg-qrow lg-rule-row"
      data-variant={variant}
      data-od={isLongOverdue(row.days) ? "long" : undefined}
      data-mine={mine || undefined}
    >
      <div className="lg-qgrid">
        {variant !== "fresh" && (
          <span className="lg-qtime">{row.days !== null && row.dueOn !== null && <OverdueMark days={row.days} dueOn={row.dueOn} short />}</span>
        )}
        <span className="lg-qn">
          <Link ref={companyLink} href={href} className="lg-qopen" title={row.name}>
            {row.name}
          </Link>
          {variant === "fresh" && row.industry && (
            <span className="lg-qind lg-trunc" title={row.industry}>
              {row.industry}
            </span>
          )}
        </span>
        {(variant === "yours" || variant === "grabs") && (
          <span className="lg-qnote lg-quote" title={row.note ?? undefined}>
            {row.note && <>&ldquo;{row.note}&rdquo;</>}
          </span>
        )}
        <span className="lg-qact">{action}</span>
      </div>

      {refused && (
        <RefusalNote
          id={row.id}
          error={refused}
          onDismiss={() => {
            refusals.set(row.id, null);
            focusSoon(() => companyLink.current);
          }}
        />
      )}
    </li>
  );
}

// ----- Held by others: collapsed, opened by itself when it holds a row you just lost -----

export function HeldByOthers({ count, ids, children }: { count: number; ids: string[]; children: ReactNode }) {
  const refusals = useContext(RefusalContext);
  // Once opened for a lost claim it stays open (dismissing the note must not fold it away under
  // the focus); the person can still close it with its own summary.
  const [opened, setOpened] = useState(false);
  const refusedHere = refusals.any(ids);
  if (refusedHere && !opened) setOpened(true);
  return (
    <Disclosure summary="Held by others" count={count} id="held" className="lg-qsection" defaultOpen={refusedHere || opened}>
      {children}
    </Disclosure>
  );
}

// ----- Fresh leads: a client-side disclosure that loads 20 at a time when opened -----

const toRow = (r: FreshRow): QueueRowData => ({ id: r.id, name: r.name, industry: r.industry, days: null, dueOn: null, note: null, claim: r.claim });

export function FreshLeads({ workspaceId, count, defaultOpen = false, windowDays }: { workspaceId: string; count: number; defaultOpen?: boolean; windowDays?: number }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<FreshRow[] | null>(null);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const busy = useRef(false);

  const load = useCallback(
    async (offset: number, focusFirstNew: boolean) => {
      if (busy.current) return;
      busy.current = true;
      setLoading(true);
      setError(null);
      try {
        const result = await loadFreshLeads(workspaceId, offset);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setRows((current) => {
          const have = new Set((offset === 0 ? [] : (current ?? [])).map((r) => r.id));
          return [...(offset === 0 ? [] : (current ?? [])), ...result.data.rows.filter((r) => !have.has(r.id))];
        });
        setMore(result.data.more);
        if (focusFirstNew) {
          focusSoon(() => list.current?.children[offset]?.querySelector<HTMLElement>("a, button") ?? null);
        }
      } catch {
        setError("Could not load fresh leads. Try again.");
      } finally {
        busy.current = false;
        setLoading(false);
      }
    },
    [workspaceId],
  );

  const show = useCallback(() => {
    setOpen(true);
    if (rows === null) void load(0, false);
  }, [rows, load]);

  // Opened from a link or the palette ("#fresh"), or from an old ?never=1 address.
  useEffect(() => {
    const open = () => {
      show();
      focusSoon(() => button.current);
    };
    const fromHash = () => {
      if (window.location.hash === "#fresh") open();
    };
    // The palette's same-page jump to "#fresh" (no hashchange fires for it).
    const fromPalette = (event: Event) => {
      if ((event as CustomEvent<string>).detail === "fresh") open();
    };
    // After the first paint, so the server's markup and the first client render agree.
    const frame = requestAnimationFrame(() => {
      if (defaultOpen) show();
      fromHash();
    });
    window.addEventListener("hashchange", fromHash);
    window.addEventListener("lg-hash", fromPalette);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("hashchange", fromHash);
      window.removeEventListener("lg-hash", fromPalette);
    };
    // Only on mount and when the hash changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const panelId = "fresh-panel";
  return (
    <section id="fresh" className="lg-disc lg-qsection" data-variant="section" data-open={open} aria-labelledby="fresh-title">
      <button
        ref={button}
        id="fresh-title"
        type="button"
        className="lg-disc-summary"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => (open ? setOpen(false) : show())}
      >
        <ChevronRightIcon size={16} className="lg-disc-chev" />
        <span className="lg-disc-title">Fresh leads</span>
        <span className="lg-disc-count">{count.toLocaleString("en-US")}</span>
      </button>
      <div id={panelId} className="lg-disc-body" hidden={!open}>
        <p className="lg-muted lg-qhint">Never contacted, and nobody else holds them.</p>
        {rows !== null && rows.length > 0 && (
          <ul ref={list} className="lg-qlist" aria-label="Fresh leads">
            {rows.map((r) => (
              <QueueRow key={r.id} workspaceId={workspaceId} row={toRow(r)} variant="fresh" windowDays={windowDays} />
            ))}
          </ul>
        )}
        {rows !== null && rows.length === 0 && !loading && <p className="lg-muted">No fresh leads right now.</p>}
        {loading && (
          <p className="lg-muted" role="status">
            Loading...
          </p>
        )}
        {error && (
          <p className="lg-error" role="alert">
            <WarningIcon size={16} />
            <span>{error}</span>
          </p>
        )}
        {rows !== null && !loading && more && (
          <p className="lg-morelink">
            <button type="button" className="lg-linkbtn" onClick={() => void load(rows.length, true)}>
              Show 20 more
            </button>
          </p>
        )}
        {rows !== null && !more && rows.length >= 100 && count > rows.length && (
          <p className="lg-morelink lg-muted">
            Showing {rows.length} of {count.toLocaleString("en-US")}.{" "}
            <Link href={`/${workspaceId}/board`} className="lg-link">
              See them all on the board
            </Link>
          </p>
        )}
      </div>
    </section>
  );
}
