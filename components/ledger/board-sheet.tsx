"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { CloseIcon } from "./icons";

// Two things the board keeps out of the way: look-alike companies and archived ones. Each is a sheet
// from the right (from the bottom on a phone) opened by a link in the board's toolbar. Whether it is
// open lives in the URL (?dupes=1, ?archived=1), so Back closes it. The content is rendered on the
// server and handed in as children.
export function BoardSheet({ title, count, closeHref, children }: { title: string; count: ReactNode; closeHref: string; children: ReactNode }) {
  const id = useId();
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const close = () => router.replace(closeHref, { scroll: false });

  useEffect(() => {
    const el = dialog.current;
    if (el && !el.open) el.showModal();
    // Closing the dialog before it leaves the page hands focus back to the link that opened it.
    return () => el?.close();
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
    </dialog>
  );
}
