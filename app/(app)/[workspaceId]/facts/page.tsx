import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Disclosure, LazyDisclosure } from "@/components/ledger/disclosure";
import { FactsIcon } from "@/components/ledger/icons";
import { PacketUpload } from "@/components/ledger/packet-upload";
import { PageHead } from "@/components/ledger/shared";
import { isConfigured } from "@/lib/ai/client";
import { aiUsage } from "@/lib/ai/run";
import { requireMembershipOr404 } from "@/lib/authz";
import { dbNow } from "@/lib/claims";
import { day } from "@/lib/dates";
import { getFactSheet, hasMaskToken, isStale, type FactSheetView } from "@/lib/facts";
import { FACT_MAX } from "@/lib/validation";
import { addFact, deleteFact, deleteFactSheet, setFactVerified, updateFact, uploadFactSheet, verifyQuotedFacts } from "./actions";
import { FactItem, FactSource, type FactView } from "./fact-item";
import "@/components/ledger/pages.css";
import { pageTitle } from "../page-title";

export async function generateMetadata({ params }: PageProps<"/[workspaceId]/facts">): Promise<Metadata> {
  const { workspaceId } = await params;
  return pageTitle(workspaceId, "Fact sheet");
}

// Reading a PDF and asking the AI for its facts can take a minute (with a fallback model, up to two).
export const maxDuration = 150;

type Fact = FactSheetView["facts"][number];
const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

// The fact sheet: the only things the AI drafter may say about the org. The owner checks what the
// AI read from the packet (waiting first), verifies, edits or adds facts; officers read the
// verified ones. Every action is the owner's, checked again on the server.
export default async function FactSheetPage({ params }: PageProps<"/[workspaceId]/facts">) {
  const { workspaceId } = await params;
  const me = await requireMembershipOr404(workspaceId);
  const tenant = { userId: me.userId, workspaceId };
  const isOwner = me.role === "owner";
  const [sheet, ai, now] = await Promise.all([getFactSheet(tenant), aiUsage(tenant), dbNow()]);

  const view = (f: Fact): FactView => ({
    id: f.id,
    text: f.text,
    fromPdf: f.source === "PDF",
    quote: f.quote,
    pageNumber: f.pageNumber,
    fileName: f.factSheet?.fileName ?? null,
    quoteFound: f.quoteFound,
    verified: f.verifiedAt !== null,
    verifiedLine: f.verifiedAt ? `Verified by ${f.verifiedBy?.name ?? "a former member"} on ${day(f.verifiedAt)}` : null,
    stale: isStale(f, now),
    masked: hasMaskToken(f.text),
  });
  const waiting = sheet.facts.filter((f) => !f.verifiedAt).map(view);
  const verified = sheet.facts.filter((f) => f.verifiedAt).map(view);

  if (!isOwner) {
    return (
      <div className="lg-page-facts">
        <PageHead title="Fact sheet" sub="Only verified facts here can appear in AI drafts." />
        <section className="lg-factsec" aria-labelledby="facts-verified-h">
          <h2 id="facts-verified-h" className="lg-factsec-h">
            {verified.length === 0 ? "No verified facts yet. Your chair adds them here." : `${plural(verified.length, "verified fact", "verified facts")} the drafter can use`}
          </h2>
          {verified.length > 0 && (
            <ul className="lg-facts-list">
              {verified.map((fact) => (
                <li key={fact.id} className="lg-fact">
                  <p className="lg-facttext">
                    <span>{fact.text}</span>
                  </p>
                  {fact.fromPdf && <FactSource fact={{ ...fact, verifiedLine: null }} />}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    );
  }

  const ids = <input type="hidden" name="workspaceId" value={workspaceId} />;
  const aiReady = isConfigured() && ai.enabled;
  const quoted = waiting.filter((f) => f.fromPdf && f.quoteFound && !f.masked).length;
  const empty = sheet.facts.length === 0;
  const list = (facts: FactView[]) => (
    <ul className="lg-facts-list">
      {facts.map((fact, i) => (
        <FactItem
          key={fact.id}
          workspaceId={workspaceId}
          fact={fact}
          nextId={facts[i + 1]?.id ?? facts[i - 1]?.id ?? null}
          setVerified={setFactVerified}
          remove={deleteFact}
          update={updateFact}
        />
      ))}
    </ul>
  );

  const addForm = (
    <ActionForm action={addFact} submitLabel="Add fact" successMessage="Added and verified." className="lg-addfact" primary={empty}>
      {ids}
      <div className="lg-addfact-field">
        <label className="lg-label" htmlFor="facts-new">
          New fact
        </label>
        <input id="facts-new" name="text" required maxLength={FACT_MAX} placeholder="Our hackathon draws 600 students." className="lg-input" />
      </div>
    </ActionForm>
  );

  const upload = (
    <>
      {!aiReady ? (
        <p>
          {isConfigured() ? (
            <>
              Turn AI on in{" "}
              <Link href={`/${workspaceId}/settings`} className="lg-link">
                Settings
              </Link>{" "}
              to read a packet.
            </>
          ) : (
            "AI isn't set up on this server yet, so a packet can't be read here."
          )}
        </p>
      ) : (
        <>
          <PacketUpload workspaceId={workspaceId} action={uploadFactSheet} />
          <p className="lg-uploadnote">A text PDF (not a scan), up to 3.5 MB and 40 pages. Reading usually takes under a minute.</p>
          <Disclosure variant="inline" summary="What is sent">
            <p className="lg-uploadnote">
              The PDF&apos;s text goes to Google&apos;s free Gemini tier with emails and phone numbers masked, so don&apos;t upload anything you wouldn&apos;t
              hand a sponsor. The facts it finds wait here until you verify them.
            </p>
          </Disclosure>
        </>
      )}
      {sheet.sheets.length > 0 && (
        <ul className="lg-files">
          {sheet.sheets.map((s) => (
            <li key={s.id}>
              <FactsIcon size={18} />
              <span className="lg-wrap-any">
                {s.fileName}: {plural(s.pageCount, "page", "pages")}, uploaded {day(s.createdAt)} by {s.uploadedBy.name}
              </span>
              <ActionForm
                action={deleteFactSheet}
                submitLabel="Delete file"
                submitAriaLabel={`Delete ${s.fileName}`}
                successMessage="File and its facts deleted."
                confirmMessage={`Delete ${s.fileName} and every fact read from it? Facts added by hand stay.`}
                small
                focusAfter=".lg-page-facts .lg-h1"
              >
                {ids}
                <input type="hidden" name="factSheetId" value={s.id} />
              </ActionForm>
            </li>
          ))}
        </ul>
      )}
    </>
  );

  return (
    <div className="lg-page-facts">
      <PageHead title="Fact sheet" sub="Only verified facts here can appear in AI drafts." />

      {empty ? (
        <>
          <section className="lg-panel" aria-labelledby="facts-add-h" data-tour="facts-add">
            <div className="lg-panel-head">
              <h2 id="facts-add-h" className="lg-panel-title">
                Add a fact
              </h2>
            </div>
            <div className="lg-panel-body">{addForm}</div>
          </section>
          <section className="lg-panel" aria-labelledby="facts-upload-h" data-tour="facts-upload">
            <div className="lg-panel-head">
              <h2 id="facts-upload-h" className="lg-panel-title">
                Or read them from your sponsorship packet
              </h2>
            </div>
            <div className="lg-panel-body">{upload}</div>
          </section>
        </>
      ) : (
        <>
          {waiting.length > 0 && (
            <section className="lg-panel" aria-labelledby="facts-waiting-h">
              <div className="lg-panel-head">
                <h2 id="facts-waiting-h" className="lg-panel-title" tabIndex={-1}>
                  Waiting for your check <span className="lg-panel-count">{waiting.length}</span>
                </h2>
                {quoted > 0 && (
                  <ActionForm
                    action={verifyQuotedFacts}
                    submitLabel={quoted === waiting.length ? `Verify all ${quoted}` : `Verify all ${quoted} with quotes found`}
                    successMessage={`${plural(quoted, "fact", "facts")} verified.`}
                    primary
                    small
                    submitDataTour="facts-verify-all"
                    focusAfter="#facts-verified-h"
                  >
                    {ids}
                  </ActionForm>
                )}
              </div>
              <div className="lg-panel-body">{list(waiting)}</div>
            </section>
          )}

          <section className="lg-panel" aria-labelledby="facts-verified-h">
            <div className="lg-panel-head">
              <h2 id="facts-verified-h" className="lg-panel-title" tabIndex={-1}>
                Verified <span className="lg-panel-count">{verified.length}</span>
              </h2>
            </div>
            <div className="lg-panel-body">
              {verified.length === 0 ? <p className="lg-muted">None yet. Drafts say nothing about your org until you verify a fact.</p> : list(verified)}
              <LazyDisclosure variant="inline" summary="+ Add a fact" className="mt-3" data-tour="facts-add">
                {addForm}
              </LazyDisclosure>
            </div>
          </section>

          <Disclosure summary="Upload another packet" count={sheet.sheets.length || undefined} data-tour="facts-upload" className="lg-factupload">
            {upload}
          </Disclosure>
        </>
      )}
    </div>
  );
}
