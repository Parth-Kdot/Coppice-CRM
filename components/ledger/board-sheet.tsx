"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition, type ReactNode } from "react";
import { unarchiveCompany } from "@/app/(app)/[workspaceId]/companies/actions";
import { ActionForm } from "@/components/action-form";
import { focusSoon } from "./focus";
import { CloseIcon, SearchIcon } from "./icons";
import { useSheetNoteLane } from "./providers";
import { MoreLink } from "./show-more";

// Two things the board keeps out of the way: look-alike companies and archived ones. Each is a sheet
// from the right (from the bottom on a phone) opened from the board's More menu. Whether it is open
// lives in the URL (?dupes=1, ?archived=1), so Back closes it. The content is rendered on the server
// and handed in as children. When it closes, focus goes back to what opened it (the More button),
// never to <body>.

// The board's More button: where focus returns when the opener is gone.
const MORE_BUTTON = '[data-tour="board-more"]';

export function BoardSheet({ title, count, closeHref, children }: { title: string; count: ReactNode; closeHref: string; children: ReactNode }) {
  const id = useId();
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const close = () => router.replace(closeHref, { scroll: false });
  // Margin notes written while the sheet is open (an archive, "Different companies") show at its foot.
  const setNoteLane = useSheetNoteLane();

  useEffect(() => {
    const el = dialog.current;
    // Whatever had focus when the sheet opened (the More button after its menu closed).
    const active = document.activeElement;
    const opener = active instanceof HTMLElement && active !== document.body && !el?.contains(active) ? active : null;
    if (el && !el.open) el.showModal();
    return () => {
      el?.close();
      // Once the sheet is gone (and not reopened, as a development double mount does), focus the
      // opener if it is still on the page, else the More button.
      focusSoon(() => {
        if (document.querySelector("dialog.lg-bsheet[open]")) return null;
        if (opener?.isConnected) return opener;
        return document.querySelector<HTMLElement>(MORE_BUTTON);
      });
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      className="lg-bsheet"
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="lg-bsheet-head">
        <h2 id={id} className="lg-h2">
          {title} <span className="lg-bsheet-count">{count}</span>
        </h2>
        <button type="button" className="lg-btn lg-btn-sm" onClick={close} aria-label={`Close ${title}`}>
          <CloseIcon size={16} />
          Close
        </button>
      </div>
      {children}
      <div className="lg-bsheet-notes" ref={setNoteLane} aria-live="polite" aria-atomic="false" />
    </dialog>
  );
}

// The Archived sheet's list: a filter box once there are more than 20, Unarchive on each row, and
// "Show 50 more" at the foot. After an unarchive the row leaves and focus moves to the next row's
// name (or the one above, or the sheet's heading), so it never falls to <body>.
export const ARCHIVED_FILTER_FROM = 20;

type ArchivedProps = {
  workspaceId: string;
  companies: { id: string; name: string; industry: string | null }[];
  // Every archived company, and those matching the filter box.
  total: number;
  matching: number;
  query: string;
  moreHref: string;
  // This sheet's URL with no filter; the box adds ?aq= to it.
  filterHref: string;
};

export function ArchivedList({ workspaceId, companies, total, matching, query, moreHref, filterHref }: ArchivedProps) {
  const prefix = useId();
  const router = useRouter();
  const [text, setText] = useState(query);
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const rowId = (id: string) => `${prefix}-a-${id}`;
  const search = (value: string) => {
    const url = new URL(filterHref, window.location.origin);
    if (value.trim()) url.searchParams.set("aq", value.trim());
    startTransition(() => router.replace(`${url.pathname}${url.search}`, { scroll: false }));
  };
  // The next row's name, else the row above's, else the sheet's heading.
  const after = (index: number) => () => {
    const next = companies[index + 1] ?? companies[index - 1];
    return (next && document.getElementById(rowId(next.id))) || document.querySelector<HTMLElement>("dialog.lg-bsheet[open] h2");
  };

  return (
    <>
      {total > ARCHIVED_FILTER_FROM && (
        <form className="lg-bsearch lg-archived-filter" role="search" onSubmit={(e) => e.preventDefault()} aria-busy={pending || undefined}>
          <SearchIcon size={18} />
          <label className="lg-sr" htmlFor={`${prefix}-filter`}>
            Filter archived companies
          </label>
          <input
            id={`${prefix}-filter`}
            type="search"
            value={text}
            maxLength={100}
            placeholder="Filter archived"
            onChange={(e) => {
              const value = e.target.value;
              setText(value);
              clearTimeout(timer.current);
              timer.current = setTimeout(() => search(value), 300);
            }}
            className="lg-input"
          />
        </form>
      )}
      {companies.length === 0 ? (
        <p className="lg-muted py-4">No archived company matches &ldquo;{query}&rdquo;.</p>
      ) : (
        <ul className="lg-archived">
          {companies.map((company, i) => (
            <li key={company.id}>
              <span className="lg-archived-name">
                <Link id={rowId(company.id)} href={`/${workspaceId}/companies/${company.id}`} className="lg-link font-semibold lg-trunc" title={company.name}>
                  {company.name}
                </Link>
                {company.industry && <span className="lg-muted lg-trunc">{company.industry}</span>}
              </span>
              <ActionForm
                action={unarchiveCompany}
                submitLabel="Unarchive"
                submitAriaLabel={`Unarchive ${company.name}`}
                small
                successMessage={`Unarchived ${company.name}.`}
                focusAfter={after(i)}
              >
                <input type="hidden" name="workspaceId" value={workspaceId} />
                <input type="hidden" name="companyId" value={company.id} />
                <input type="hidden" name="stay" value="board" />
              </ActionForm>
            </li>
          ))}
        </ul>
      )}
      <MoreLink href={moreHref} shown={companies.length} total={matching} step={50} cap={200} />
    </>
  );
}
