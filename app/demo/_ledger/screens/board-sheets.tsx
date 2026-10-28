"use client";

import Link from "next/link";
import { useId, useState, type ReactNode } from "react";
import type { DuplicatePair } from "@/demo/selectors";
import { demoRoutes } from "@/demo/routes";
import { useDemoActions } from "@/demo/store";
import type { Company, MatchReason } from "@/demo/types";
import { CloseIcon, DuplicateIcon, PaperclipIcon } from "../icons";
import { useConfirm, useNotify } from "../providers";
import { ErrorLine } from "./shared";

// Two things the board keeps out of the way: look-alike companies and archived ones. Each is a sheet
// from the right (from the bottom on a phone) that opens from a button in the board's toolbar, and
// the open state lives in the URL (?dupes=1, ?archived=1), so Back closes it.

const matchText = (reasons: MatchReason[]) => (reasons.length === 2 ? "same name and website" : reasons[0] === "website" ? "same website" : "same name");

export function BoardSheet({ title, count, onClose, children }: { title: string; count: ReactNode; onClose: () => void; children: ReactNode }) {
  const id = useId();
  return (
    <dialog
      ref={(el) => {
        if (el && !el.open) el.showModal();
      }}
      className="lg-bsheet"
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="lg-bsheet-head">
        <h2 id={id} className="lg-h2">
          {title} <span className="lg-bsheet-count">{count}</span>
        </h2>
        <button type="button" className="lg-btn lg-btn-sm" onClick={onClose} aria-label={`Close ${title}`}>
          <CloseIcon size={16} />
          Close
        </button>
      </div>
      {children}
    </dialog>
  );
}

function DuplicatePairRow({ ws, pair }: { ws: string; pair: DuplicatePair }) {
  const actions = useDemoActions();
  const confirm = useConfirm();
  const notify = useNotify();
  const [error, setError] = useState<string | null>(null);

  const archive = async (keep: DuplicatePair["a"], drop: DuplicatePair["a"]) => {
    const ok = await confirm({ message: `Archive ${drop.name} and keep ${keep.name}? You can unarchive it later.`, confirmLabel: `Archive ${drop.name}` });
    if (!ok) return;
    const result = actions.archiveDuplicate(ws, keep.id, drop.id);
    if (!result.ok) setError(result.error);
    else notify(`${drop.name} archived. ${keep.name} kept.`);
  };

  return (
    <li className="lg-pair">
      <PaperclipIcon size={22} className="lg-pair-clip" />
      <div className="lg-pair-slips">
        {[pair.a, pair.b].map((side) => (
          <div key={side.id} className="lg-slip lg-pair-slip">
            <Link href={demoRoutes.company(ws, side.id)} className="lg-link font-semibold">
              {side.name}
            </Link>
            <p className="lg-muted text-sm">{side.website ?? "No website"}</p>
          </div>
        ))}
      </div>
      <p className="lg-pair-why">
        <DuplicateIcon size={16} /> Matches on {matchText(pair.matchedOn)}.
      </p>
      <div className="lg-actions">
        <button type="button" className="lg-btn lg-btn-sm" onClick={() => archive(pair.b, pair.a)}>
          Same company: archive {pair.a.name}
        </button>
        <button type="button" className="lg-btn lg-btn-sm" onClick={() => archive(pair.a, pair.b)}>
          Same company: archive {pair.b.name}
        </button>
        <button
          type="button"
          className="lg-btn lg-btn-sm"
          onClick={() => {
            const result = actions.keepSeparate(ws, pair.a.id, pair.b.id);
            if (!result.ok) setError(result.error);
            else notify("Kept as separate entries. They will not be flagged again.");
          }}
        >
          Separate entries
        </button>
      </div>
      <ErrorLine>{error}</ErrorLine>
    </li>
  );
}

export function DuplicatesSheet({ ws, pairs, capped, onClose }: { ws: string; pairs: DuplicatePair[]; capped: boolean; onClose: () => void }) {
  return (
    <BoardSheet title="Possible duplicates" count={capped ? "50+" : pairs.length} onClose={onClose}>
      <p className="lg-hint">Companies that look alike (same name ignoring case and Inc/LLC/Corp, or same website). Archive the copy, or keep both as separate entries so they stop being flagged.</p>
      {pairs.length === 0 ? (
        <p className="lg-muted py-4">No look-alike pairs right now.</p>
      ) : (
        <ul className="lg-pairs">
          {pairs.map((pair) => (
            <DuplicatePairRow key={`${pair.a.id}|${pair.b.id}`} ws={ws} pair={pair} />
          ))}
        </ul>
      )}
    </BoardSheet>
  );
}

export function ArchivedSheet({ ws, count, list, onClose }: { ws: string; count: number; list: Company[] | null; onClose: () => void }) {
  const actions = useDemoActions();
  const notify = useNotify();
  return (
    <BoardSheet title="Archived" count={count} onClose={onClose}>
      {list === null ? (
        <p className="lg-muted py-4">Nothing is archived.</p>
      ) : (
        <ul className="lg-archived">
          {list.map((c) => (
            <li key={c.id}>
              <div>
                <Link href={demoRoutes.company(ws, c.id)} className="lg-link font-semibold">
                  {c.name}
                </Link>
                {c.industry && <span className="lg-muted">, {c.industry}</span>}
              </div>
              <button
                type="button"
                className="lg-btn lg-btn-sm"
                onClick={() => {
                  const result = actions.unarchiveCompany(ws, c.id);
                  if (result.ok) notify(`${c.name} is back on the board.`);
                  else notify(result.error, "error");
                }}
              >
                Unarchive
              </button>
            </li>
          ))}
        </ul>
      )}
    </BoardSheet>
  );
}
