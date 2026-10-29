"use client";

import Link from "next/link";
import { ActionForm } from "@/components/ledger/action-form";
import { CheckIcon, FactsIcon, WarningIcon } from "@/components/ledger/icons";
import { Tick, YearMargin } from "@/components/ledger/marks";
import { PacketUpload } from "@/components/ledger/packet-upload";
import { Empty, PageHead } from "@/components/ledger/shared";
import { day } from "@/lib/dates";
import { FACT_MAX } from "@/lib/validation";
import { useFactSheet } from "@/demo/store";
import type { FactSheetView } from "@/demo/selectors";
import { useFormActions } from "../form-actions";
import "@/components/ledger/pages.css";

type Fact = FactSheetView["verified"][number];

// Facts read from a packet are listed under the page they came from, hand-written ones under their own heading.
type Group = { key: string; title: string; facts: Fact[] };
function groupByPage(facts: Fact[], showFile: boolean): Group[] {
  const groups = new Map<string, Group>();
  for (const fact of facts) {
    const file = fact.fileName ?? "a deleted file";
    const of = showFile ? ` of ${file}` : "";
    const [key, title] =
      fact.source === "PDF"
        ? fact.pageNumber
          ? [`p${fact.pageNumber}:${file}`, `Page ${fact.pageNumber}${of}`]
          : [`p0:${file}`, `Page unknown${of}`]
        : ["hand", "Added by hand"];
    const group = groups.get(key) ?? { key, title, facts: [] };
    group.facts.push(fact);
    groups.set(key, group);
  }
  const rank = (g: Group) => (g.key === "hand" ? Infinity : Number(g.key.slice(1, g.key.indexOf(":"))) || 1e6);
  return [...groups.values()].sort((a, b) => rank(a) - rank(b));
}

export function FactsPage({ ws: workspaceId }: { ws: string }) {
  const sheet = useFactSheet(workspaceId);
  const a = useFormActions();
  const { setFactVerified, updateFact, addFact, deleteFact, deleteFactSheet, uploadFactSheet } = a;
  const isOwner = sheet.isOwner;
  const unverified = sheet.unverified;
  const verified = sheet.verified;
  const allFacts = [...unverified, ...verified];
  const ids = <input type="hidden" name="workspaceId" value={workspaceId} />;
  const aiReady = sheet.ai.available;

  const factRow = (fact: Fact) => {
    const isVerified = fact.verifiedAt !== null;
    return (
      <li key={fact.id} className="lg-fact" data-verified={isVerified || undefined}>
        <YearMargin iso={fact.verifiedAt ?? fact.createdAt} />
        <span className="lg-factmark" role="img" aria-label={isVerified ? "Verified" : "Not verified"}>
          {isVerified && <Tick size={20} />}
        </span>
        <div className="lg-factbody">
          <p className="lg-facttext">{fact.text}</p>
          {fact.source === "PDF" ? (
            <>
              {fact.quote && (
                <p className="lg-factsrc">
                  <span className="lg-quote">&ldquo;{fact.quote}&rdquo;</span>
                </p>
              )}
              <p className={`lg-quotecheck ${fact.quoteFound ? "lg-ok" : "lg-late"}`}>
                {fact.quoteFound ? <CheckIcon size={16} /> : <WarningIcon size={16} />}
                <span>
                  {fact.quoteFound
                    ? "Quote found on that page"
                    : "Quote not found on that page, or it doesn't match the fact. Check the PDF."}
                </span>
              </p>
            </>
          ) : (
            <p className="lg-factsrc">Added by hand</p>
          )}
          {(isVerified || fact.stale) && (
            <p className="lg-factmeta">
              {isVerified && (
                <span>
                  Verified by {fact.verifiedByName ?? "a former member"} on {day(new Date(fact.verifiedAt as string))}
                </span>
              )}
              {fact.stale && <span className="lg-badge lg-badge-stale">Stale: over a year old</span>}
            </p>
          )}
          {isOwner && (
            <div className="lg-factacts">
              <ActionForm
                action={setFactVerified}
                submitLabel={isVerified ? "Unverify" : "Verify"}
                successMessage={isVerified ? "Fact unverified." : "Fact verified."}
                primary={!isVerified}
                small
              >
                {ids}
                <input type="hidden" name="factId" value={fact.id} />
                <input type="hidden" name="verified" value={isVerified ? "0" : "1"} />
              </ActionForm>
              <ActionForm action={deleteFact} submitLabel="Delete" successMessage="Fact deleted." confirmMessage="Delete this fact?" small>
                {ids}
                <input type="hidden" name="factId" value={fact.id} />
              </ActionForm>
              <details className="lg-factedit">
                <summary>Edit (saving also verifies it)</summary>
                <ActionForm action={updateFact} submitLabel="Save fact" successMessage="Fact saved and verified." className="lg-editform" small>
                  {ids}
                  <input type="hidden" name="factId" value={fact.id} />
                  <label className="lg-label" htmlFor={`edit-${fact.id}`}>
                    Fact
                  </label>
                  <textarea id={`edit-${fact.id}`} name="text" required maxLength={FACT_MAX} rows={2} defaultValue={fact.text} className="lg-textarea" />
                </ActionForm>
              </details>
            </div>
          )}
        </div>
      </li>
    );
  };

  const factList = (facts: Fact[]) => {
    const groups = groupByPage(facts, sheet.sheets.length > 1);
    return (
      <div>
        {groups.map((group) => (
          <section key={group.key} className="lg-factgroup" aria-label={group.title}>
            <h3 className="lg-factgroup-h lg-tag">{group.title}</h3>
            <ul className="lg-facts-list">
              {group.facts.map((fact) => factRow(fact))}
            </ul>
          </section>
        ))}
      </div>
    );
  };

  return (
    <div className="lg-page-facts">
      <PageHead
        title="Fact sheet"
        sub="The AI drafter may only state facts on this page, and only once an owner has verified them. Upload your sponsorship packet and the AI lists its facts with the sentence and page each came from; check each one against your packet before verifying it."
      />
      {allFacts.length > 0 && (
        <p className="lg-factsum">
          <span>
            <strong>{allFacts.length}</strong> {allFacts.length === 1 ? "fact" : "facts"}
          </span>
          <span>
            <strong>{verified.length}</strong> verified
          </span>
          {isOwner && (
            <span>
              <strong>{unverified.length}</strong> waiting for your check
            </span>
          )}
        </p>
      )}

      {isOwner && (
        <section className="lg-panel" aria-labelledby="facts-upload">
          <div className="lg-panel-head">
            <h2 id="facts-upload" className="lg-panel-title">
              Upload the sponsorship packet
            </h2>
          </div>
          <div className="lg-panel-body">
            {!aiReady ? (
              <p>
                {sheet.ai.serverConfigured ? (
                  <>
                    Turn AI on in{" "}
                    <Link href={`/demo/w/${workspaceId}/settings`} className="lg-link">
                      Settings
                    </Link>{" "}
                    to read a packet.
                  </>
                ) : (
                  "AI isn't set up on this server yet, so a packet can't be read here."
                )}{" "}
                You can still add facts by hand below.
              </p>
            ) : (
              <>
                <PacketUpload workspaceId={workspaceId} action={uploadFactSheet} />
                <p className="lg-uploadnote">
                  A text PDF (not a scan), up to 3.5 MB and 40 pages. Reading it takes up to a minute. Its text goes to Google&apos;s free Gemini
                  tier with emails and phone numbers masked, so don&apos;t upload anything you wouldn&apos;t hand a sponsor.
                </p>
              </>
            )}
            {sheet.sheets.length > 0 && (
              <ul className="lg-files">
                {sheet.sheets.map((s) => (
                  <li key={s.id}>
                    <FactsIcon size={18} />
                    <span>
                      {s.fileName}: {s.pageCount} {s.pageCount === 1 ? "page" : "pages"}, uploaded {day(new Date(s.createdAt))} by {s.uploadedByName}
                    </span>
                    <ActionForm
                      action={deleteFactSheet}
                      submitLabel="Delete file"
                      successMessage="File and its facts deleted."
                      confirmMessage={`Delete ${s.fileName} and every fact read from it? Facts added by hand stay.`}
                      small
                    >
                      {ids}
                      <input type="hidden" name="factSheetId" value={s.id} />
                    </ActionForm>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      {isOwner && (
        <section className="lg-panel" aria-labelledby="facts-waiting">
          <div className="lg-panel-head">
            <h2 id="facts-waiting" className="lg-panel-title">
              Waiting for your check
            </h2>
            <span className="lg-panel-count">{unverified.length}</span>
          </div>
          {unverified.length > 0 && <p className="lg-panel-note">The drafter does not use these until you verify them.</p>}
          <div className="lg-panel-body">
            {unverified.length === 0 ? <p className="lg-muted">Nothing to check.</p> : factList(unverified)}
          </div>
        </section>
      )}

      <section className="lg-panel" aria-labelledby="facts-verified">
        <div className="lg-panel-head">
          <h2 id="facts-verified" className="lg-panel-title">
            Verified
          </h2>
          <span className="lg-panel-count">{verified.length}</span>
        </div>
        <div className="lg-panel-body">
          {verified.length === 0 ? (
            <Empty kind="facts">
              <p className="lg-empty-title">No verified facts yet, so the drafter has nothing to say about your org.</p>
            </Empty>
          ) : (
            factList(verified)
          )}
        </div>
      </section>

      {isOwner && (
        <section className="lg-panel" aria-labelledby="facts-add">
          <div className="lg-panel-head">
            <h2 id="facts-add" className="lg-panel-title">
              Add a fact by hand
            </h2>
          </div>
          <div className="lg-panel-body">
            <ActionForm action={addFact} submitLabel="Add fact" successMessage="Added and verified." className="lg-addfact" primary>
              {ids}
              <div className="lg-addfact-field">
                <label className="lg-label" htmlFor="facts-new">
                  New fact
                </label>
                <input id="facts-new" name="text" required maxLength={FACT_MAX} placeholder="Our hackathon draws 600 students." className="lg-input" />
              </div>
            </ActionForm>
          </div>
        </section>
      )}
    </div>
  );
}
