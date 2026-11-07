import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Disclosure, LazyDisclosure } from "@/components/ledger/disclosure";
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
import { FactBoard } from "./fact-board";
import { ReadOnlyFacts, type FactView } from "./fact-item";
import { PacketFiles } from "./packet-files";
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

// The fact sheet: the only things the AI drafter may say about the org. Every fact shows its
// quote and whether the quote was found on its page, grouped by page, so the owner can check and
// verify (or edit) it in place; officers read the verified ones. Every action is the owner's,
// checked again on the server.
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
  const facts = sheet.facts.map(view);
  const showFile = sheet.sheets.length > 1;

  if (!isOwner) {
    const verified = facts.filter((f) => f.verified);
    return (
      <div className="lg-page-facts">
        <PageHead title="Fact sheet" sub="Only verified facts here can appear in AI drafts." />
        <section className="lg-panel lg-factpanel" aria-labelledby="facts-verified-h">
          <div className="lg-panel-head">
            <h2 id="facts-verified-h" className="lg-panel-title">
              Verified <span className="lg-panel-count">{verified.length}</span>
            </h2>
          </div>
          <div className="lg-panel-body">
            {verified.length === 0 ? <p className="lg-muted">No verified facts yet. An owner adds them here.</p> : <ReadOnlyFacts facts={verified} showFile={showFile} />}
          </div>
        </section>
      </div>
    );
  }

  const ids = <input type="hidden" name="workspaceId" value={workspaceId} />;
  const aiReady = isConfigured() && ai.enabled;
  const empty = facts.length === 0;
  const hasPacket = sheet.sheets.length > 0;

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

  const upload = !aiReady ? (
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
      )}{" "}
      You can still add facts by hand.
    </p>
  ) : (
    <>
      <PacketUpload workspaceId={workspaceId} action={uploadFactSheet} />
      <p className="lg-uploadnote">A text PDF (not a scan), up to 3.5 MB and 40 pages. Reading usually takes under a minute.</p>
      <Disclosure variant="inline" summary="What is sent">
        <p className="lg-uploadnote">
          The PDF&apos;s text goes to Google&apos;s free Gemini tier with emails and phone numbers masked, so don&apos;t upload anything you wouldn&apos;t hand a
          sponsor. The facts it finds wait here until you verify them.
        </p>
      </Disclosure>
    </>
  );

  return (
    <div className="lg-page-facts">
      <PageHead title="Fact sheet" sub="Only verified facts here can appear in AI drafts." />

      {hasPacket ? (
        <PacketFiles
          workspaceId={workspaceId}
          remove={deleteFactSheet}
          upload={upload}
          files={sheet.sheets.map((s) => ({
            id: s.id,
            fileName: s.fileName,
            line: `${plural(s.pageCount, "page", "pages")}, uploaded ${day(s.createdAt)} by ${s.uploadedBy.name}`,
          }))}
        />
      ) : (
        <section className="lg-panel" aria-labelledby="facts-upload-h" data-tour="facts-upload">
          <div className="lg-panel-head">
            <h2 id="facts-upload-h" className="lg-panel-title">
              Read facts from your sponsorship packet
            </h2>
          </div>
          <div className="lg-panel-body">{upload}</div>
        </section>
      )}

      <FactBoard
        workspaceId={workspaceId}
        facts={facts}
        showFile={showFile}
        setVerified={setFactVerified}
        remove={deleteFact}
        update={updateFact}
        verifyQuoted={verifyQuotedFacts}
        addSlot={
          empty ? (
            <div className="lg-factadd" data-tour="facts-add">
              {addForm}
            </div>
          ) : (
            <LazyDisclosure variant="inline" summary="+ Add a fact" className="lg-factadd" data-tour="facts-add">
              {addForm}
            </LazyDisclosure>
          )
        }
      />
    </div>
  );
}
