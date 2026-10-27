"use client";

import Link from "next/link";
import { useId, useState, type FormEvent } from "react";
import { formatDay } from "@/demo/dates";
import { demoRoutes } from "@/demo/routes";
import type { FactView } from "@/demo/selectors";
import { useDemoActions, useFactSheet } from "@/demo/store";
import { FACT_MAX } from "@/demo/validation";
import { CheckIcon, FactsIcon, WarningIcon } from "../icons";
import { Tick, YearMargin } from "../marks";
import { useConfirm, useNotify } from "../providers";
import { Empty, ErrorLine, PageHead } from "./shared";

// The fact sheet: each fact is an entry with its page number and its quote in italic. An owner
// verifies a fact with a tick in the margin; nothing is used by the AI drafter until then.

function Quill({ label }: { label: string }) {
  return (
    <div className="lg-quill-wait" role="status">
      <svg viewBox="0 0 240 28" preserveAspectRatio="none" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden="true">
        <path pathLength={1} d="M2 15 C14 3 26 3 38 15 S62 27 74 15 S98 3 110 15 S134 27 146 15 S170 3 182 15 S206 27 218 15 S232 6 238 12" />
      </svg>
      <span>{label}</span>
    </div>
  );
}

function FactEntry({ ws, fact, isOwner }: { ws: string; fact: FactView; isOwner: boolean }) {
  const actions = useDemoActions();
  const confirm = useConfirm();
  const notify = useNotify();
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState(fact.text);
  const verified = fact.verifiedAt !== null;

  const run = (result: { ok: boolean; error?: string }, done?: string) => {
    if (!result.ok) setError(result.error ?? null);
    else {
      setError(null);
      if (done) notify(done);
    }
  };

  return (
    <li className="lg-fact" data-verified={verified || undefined}>
      <YearMargin iso={fact.verifiedAt ?? fact.createdAt} />
      <span className="lg-factmark" aria-hidden="true">
        {verified && <Tick size={20} />}
      </span>
      <div className="lg-factbody">
        <p className="lg-facttext">{fact.text}</p>
        <p className="lg-factsrc">
          {fact.sourceLabel}
          {fact.source === "PDF" && fact.quote ? (
            <>
              : <span className="lg-quote">&ldquo;{fact.quote}&rdquo;</span>
            </>
          ) : null}
        </p>
        {fact.source === "PDF" && (
          <p className={`lg-quotecheck ${fact.quoteFound ? "lg-ok" : "lg-late"}`}>
            {fact.quoteFound ? <CheckIcon size={16} /> : <WarningIcon size={16} />}
            {fact.quoteFound ? "quote found on that page" : "quote not found on that page, or it doesn't match the fact. Check the PDF."}
          </p>
        )}
        <p className="lg-factmeta">
          {verified ? `Verified by ${fact.verifiedByName ?? "a former member"} on ${formatDay(fact.verifiedAt as string)}` : "Not verified yet. The drafter will not use it."}
          {fact.stale && <span className="lg-badge lg-badge-stale ml-2">Stale: over a year old</span>}
        </p>

        {isOwner && (
          <div className="lg-actions mt-2">
            <button type="button" className={`lg-btn lg-btn-sm ${verified ? "" : "lg-btn-primary"}`} onClick={() => run(actions.setFactVerified(ws, fact.id, !verified), verified ? "Fact unverified." : "Fact verified.")}>
              {verified ? "Unverify" : "Verify"}
            </button>
            <button
              type="button"
              className="lg-btn lg-btn-sm"
              onClick={async () => {
                const ok = await confirm({ message: "Delete this fact?", confirmLabel: "Delete fact" });
                if (ok) run(actions.deleteFact(ws, fact.id), "Fact deleted.");
              }}
            >
              Delete
            </button>
            <details className="lg-more">
              <summary>Edit (saving also verifies it)</summary>
              <form
                className="lg-contactform"
                onSubmit={(e: FormEvent) => {
                  e.preventDefault();
                  run(actions.updateFact(ws, fact.id, text), "Fact saved and verified.");
                }}
              >
                <label className="lg-label" htmlFor={`${id}-edit`}>
                  Fact
                </label>
                <textarea id={`${id}-edit`} className="lg-textarea" rows={2} maxLength={FACT_MAX + 40} value={text} onChange={(e) => setText(e.target.value)} />
                <div>
                  <button type="submit" className="lg-btn lg-btn-sm">
                    Save fact
                  </button>
                </div>
              </form>
            </details>
          </div>
        )}
        <ErrorLine>{error}</ErrorLine>
      </div>
    </li>
  );
}

export function FactsScreen({ ws }: { ws: string }) {
  const sheet = useFactSheet(ws);
  const actions = useDemoActions();
  const confirm = useConfirm();
  const notify = useNotify();
  const id = useId();
  const [newFact, setNewFact] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadDone, setUploadDone] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const upload = async (file: { name: string; size: number } | null) => {
    setUploadError(null);
    setUploadDone(false);
    const result = await actions.uploadFactSheet(ws, file);
    if (!result.ok) setUploadError(result.error);
    else setUploadDone(true);
  };

  const add = (e: FormEvent) => {
    e.preventDefault();
    const result = actions.addFact(ws, newFact);
    if (!result.ok) {
      setAddError(result.error);
      return;
    }
    setAddError(null);
    setNewFact("");
    notify("Added and verified.");
  };

  return (
    <div className="lg-facts">
      <PageHead title="Fact sheet">
        <Link href={demoRoutes.settings(ws)} className="lg-btn">
          Back
        </Link>
      </PageHead>
      <p className="max-w-[66ch]">
        The AI drafter may only state facts on this page, and only once an owner has verified them. Upload your sponsorship packet and the AI lists its facts with the sentence and page each came from; check each one against your packet before verifying it.
      </p>

      {sheet.isOwner && (
        <section className="lg-leaf-page lg-sheet lg-ipage" aria-labelledby={`${id}-up`}>
          <h2 id={`${id}-up`} className="lg-bh">
            Upload the sponsorship packet
          </h2>
          {!sheet.ai.available ? (
            <p>
              Turn AI on in{" "}
              <Link href={demoRoutes.settings(ws)} className="lg-link">
                Settings
              </Link>{" "}
              to read a packet. You can still add facts by hand below.
            </p>
          ) : (
            <>
              <div className="lg-actions">
                <input
                  type="file"
                  accept=".pdf,application/pdf"
                  className="lg-file"
                  aria-label="Sponsorship packet PDF"
                  disabled={sheet.uploading}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    setFileError(null);
                    if (f) upload({ name: f.name, size: f.size });
                    else setFileError("Choose a PDF file.");
                    e.target.value = "";
                  }}
                />
                <button type="button" className="lg-btn" disabled={sheet.uploading} onClick={() => upload({ name: "BRC-Sponsorship-Packet-2026-27-v2.pdf", size: 1_400_000 })}>
                  {sheet.uploading ? "Working..." : "Upload and read a sample packet"}
                </button>
              </div>
              <p className="lg-hint mt-2 max-w-[66ch]">
                A text PDF (not a scan), up to 3.5 MB and 40 pages. Reading it takes up to a minute. Its text goes to Google&apos;s free Gemini tier with emails and phone numbers masked, so don&apos;t upload anything you wouldn&apos;t hand a sponsor.
              </p>
              {sheet.uploading && <Quill label="Working... reading the packet" />}
              {uploadDone && !uploadError && (
                <p className="lg-ok mt-2" role="status">
                  <Tick size={18} />
                  Done. Check the facts below.
                </p>
              )}
              <ErrorLine>{uploadError ?? fileError}</ErrorLine>
            </>
          )}
          {sheet.sheets.length > 0 && (
            <ul className="lg-files">
              {sheet.sheets.map((s) => (
                <li key={s.id}>
                  <FactsIcon size={18} />
                  <span>
                    {s.fileName}: {s.pageCount} pages, uploaded {formatDay(s.createdAt)} by {s.uploadedByName}
                  </span>
                  <button
                    type="button"
                    className="lg-btn lg-btn-sm"
                    onClick={async () => {
                      const ok = await confirm({ message: `Delete ${s.fileName} and every fact read from it? Facts added by hand stay.`, confirmLabel: "Delete file" });
                      if (!ok) return;
                      const r = actions.deleteFactSheet(ws, s.id);
                      if (!r.ok) setUploadError(r.error);
                      else notify("File and its facts deleted.");
                    }}
                  >
                    Delete file
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {sheet.isOwner && (
        <section className="lg-leaf-page lg-sheet lg-ipage" aria-labelledby={`${id}-wait`}>
          <h2 id={`${id}-wait`} className="lg-bh">
            Waiting for your check ({sheet.unverified.length})
          </h2>
          {sheet.unverified.length === 0 ? (
            <p className="lg-muted">Nothing to check.</p>
          ) : (
            <ul className="lg-facts-list">
              {sheet.unverified.map((f) => (
                <FactEntry key={f.id} ws={ws} fact={f} isOwner />
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="lg-leaf-page lg-sheet lg-ipage" aria-labelledby={`${id}-ver`}>
        <h2 id={`${id}-ver`} className="lg-bh">
          Verified ({sheet.verified.length})
        </h2>
        {sheet.verified.length === 0 ? (
          <Empty kind="facts">
            <p className="lg-empty-title">No verified facts yet, so the drafter has nothing to say about your org.</p>
          </Empty>
        ) : (
          <ul className="lg-facts-list">
            {sheet.verified.map((f) => (
              <FactEntry key={f.id} ws={ws} fact={f} isOwner={sheet.isOwner} />
            ))}
          </ul>
        )}
      </section>

      {sheet.isOwner && (
        <section className="lg-leaf-page lg-sheet lg-ipage" aria-labelledby={`${id}-add`}>
          <h2 id={`${id}-add`} className="lg-bh">
            Add a fact by hand
          </h2>
          <form onSubmit={add} className="lg-addfact">
            <div>
              <label className="lg-label" htmlFor={`${id}-new`}>
                New fact
              </label>
              <input id={`${id}-new`} className="lg-input" placeholder="Our hackathon draws 600 students." value={newFact} onChange={(e) => setNewFact(e.target.value)} />
            </div>
            <button type="submit" className="lg-btn lg-btn-primary">
              Add fact
            </button>
          </form>
          <ErrorLine>{addError}</ErrorLine>
        </section>
      )}
    </div>
  );
}
