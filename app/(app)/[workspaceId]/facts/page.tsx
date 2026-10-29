import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { isConfigured } from "@/lib/ai/client";
import { aiUsage } from "@/lib/ai/run";
import { requireMembershipOr404 } from "@/lib/authz";
import { dbNow } from "@/lib/claims";
import { day } from "@/lib/dates";
import { getFactSheet, isStale, type FactSheetView } from "@/lib/facts";
import { FACT_MAX } from "@/lib/validation";
import { addFact, deleteFact, deleteFactSheet, setFactVerified, updateFact, uploadFactSheet } from "./actions";

// Reading a PDF and asking the AI for its facts can take a minute (with a fallback model, up to two).
export const maxDuration = 150;

type Fact = FactSheetView["facts"][number];

export default async function FactSheetPage({ params }: PageProps<"/[workspaceId]/facts">) {
  const { workspaceId } = await params;
  const me = await requireMembershipOr404(workspaceId);
  const tenant = { userId: me.userId, workspaceId };
  const isOwner = me.role === "owner";
  const [sheet, ai, now] = await Promise.all([getFactSheet(tenant), aiUsage(tenant), dbNow()]);

  const unverified = sheet.facts.filter((f) => !f.verifiedAt);
  const verified = sheet.facts.filter((f) => f.verifiedAt);
  const ids = <input type="hidden" name="workspaceId" value={workspaceId} />;

  function FactRow({ fact }: { fact: Fact }) {
    return (
      <li className="flex flex-col gap-1 rounded border p-3">
        <span className="font-medium">{fact.text}</span>
        {fact.source === "PDF" ? (
          <span className="text-sm text-zinc-500">
            {fact.pageNumber ? `Page ${fact.pageNumber}` : "Page unknown"} of {fact.factSheet?.fileName ?? "a deleted file"}
            {fact.quote && <>: &ldquo;{fact.quote}&rdquo;</>}{" "}
            {fact.quoteFound ? (
              <span className="text-green-700">✓ quote found on that page</span>
            ) : (
              <span className="text-amber-700">⚠ quote not found on that page, or it doesn&apos;t match the fact. Check the PDF.</span>
            )}
          </span>
        ) : (
          <span className="text-sm text-zinc-500">Added by hand</span>
        )}
        {fact.verifiedAt && (
          <span className="text-sm text-zinc-500">
            Verified by {fact.verifiedBy?.name ?? "a former member"} on {day(fact.verifiedAt)}
            {isStale(fact, now) && <span className="ml-2 rounded bg-amber-200 px-1 text-zinc-900">Stale: over a year old</span>}
          </span>
        )}
        {isOwner && (
          <div className="flex flex-wrap items-center gap-2">
            <ActionForm action={setFactVerified} submitLabel={fact.verifiedAt ? "Unverify" : "Verify"}>
              {ids}
              <input type="hidden" name="factId" value={fact.id} />
              <input type="hidden" name="verified" value={fact.verifiedAt ? "0" : "1"} />
            </ActionForm>
            <ActionForm action={deleteFact} submitLabel="Delete" confirmMessage="Delete this fact?">
              {ids}
              <input type="hidden" name="factId" value={fact.id} />
            </ActionForm>
            <details className="w-full">
              <summary className="cursor-pointer text-sm text-zinc-600">Edit (saving also verifies it)</summary>
              <div className="pt-2">
                <ActionForm action={updateFact} submitLabel="Save fact">
                  {ids}
                  <input type="hidden" name="factId" value={fact.id} />
                  <input
                    name="text"
                    required
                    maxLength={FACT_MAX}
                    defaultValue={fact.text}
                    aria-label="Fact"
                    className="w-full rounded border px-2 py-1"
                  />
                </ActionForm>
              </div>
            </details>
          </div>
        )}
      </li>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 p-8">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Fact sheet</h1>
        <Link href={`/${workspaceId}/settings`} className="rounded border px-3 py-1">
          Back
        </Link>
      </header>
      <p className="text-sm text-zinc-500">
        The AI drafter may only state facts on this page, and only once an owner has verified them. Upload your sponsorship packet and
        the AI lists its facts with the sentence and page each came from; check each one against your packet before verifying it.
      </p>

      {isOwner && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Upload the sponsorship packet</h2>
          {!isConfigured() || !ai.enabled ? (
            <p className="text-sm text-amber-700">
              Turn AI on in <Link href={`/${workspaceId}/settings`} className="underline">Settings</Link> to read a packet. You can
              still add facts by hand below.
            </p>
          ) : (
            <>
              <p className="text-sm text-zinc-500">
                A text PDF (not a scan), up to 3.5 MB and 40 pages. Reading it takes up to a minute. Its text goes to Google&apos;s free
                Gemini tier with emails and phone numbers masked, so don&apos;t upload anything you wouldn&apos;t hand a sponsor.
              </p>
              <ActionForm action={uploadFactSheet} submitLabel="Upload and read" successMessage="Done. Check the facts below.">
                {ids}
                <input name="file" type="file" accept="application/pdf,.pdf" required aria-label="Sponsorship packet PDF" />
              </ActionForm>
            </>
          )}
          {sheet.sheets.length > 0 && (
            <ul className="flex flex-col gap-2 text-sm">
              {sheet.sheets.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-3">
                  <span>
                    {s.fileName}: {s.pageCount} {s.pageCount === 1 ? "page" : "pages"}, uploaded {day(s.createdAt)} by {s.uploadedBy.name}
                  </span>
                  <ActionForm
                    action={deleteFactSheet}
                    submitLabel="Delete file"
                    confirmMessage={`Delete ${s.fileName} and every fact read from it? Facts added by hand stay.`}
                  >
                    {ids}
                    <input type="hidden" name="factSheetId" value={s.id} />
                  </ActionForm>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {isOwner && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Waiting for your check ({unverified.length})</h2>
          {unverified.length === 0 && <p className="text-sm text-zinc-500">Nothing to check.</p>}
          <ul className="flex flex-col gap-3">
            {unverified.map((fact) => (
              <FactRow key={fact.id} fact={fact} />
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Verified ({verified.length})</h2>
        {verified.length === 0 && <p className="text-sm text-zinc-500">No verified facts yet, so the drafter has nothing to say about your org.</p>}
        <ul className="flex flex-col gap-3">
          {verified.map((fact) => (
            <FactRow key={fact.id} fact={fact} />
          ))}
        </ul>
      </section>

      {isOwner && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Add a fact by hand</h2>
          <ActionForm action={addFact} submitLabel="Add fact" successMessage="Added and verified.">
            {ids}
            <input
              name="text"
              required
              maxLength={FACT_MAX}
              placeholder="Our hackathon draws 600 students."
              aria-label="New fact"
              className="w-full rounded border px-2 py-1"
            />
          </ActionForm>
        </section>
      )}
    </div>
  );
}
