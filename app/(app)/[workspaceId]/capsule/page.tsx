import type { Metadata } from "next";
import Link from "next/link";
import { Disclosure } from "@/components/ledger/disclosure";
import { ArchiveAsk } from "@/components/ledger/capsule/archive-ask";
import { Handoff } from "@/components/ledger/capsule/handoff";
import { firstStep } from "@/components/ledger/capsule/steps";
import { PlaybookView } from "@/components/ledger/capsule/playbook-view";
import { PublishedCapsule } from "@/components/ledger/capsule/published";
import { RecapReader } from "@/components/ledger/capsule/recap-reader";
import { recapPages } from "@/components/ledger/capsule/recap-pages";
import { CapsuleStamp } from "@/components/ledger/capsule/stamp";
import { YearMenu } from "@/components/ledger/capsule/year-menu";
import { plural } from "@/components/ledger/capsule/format";
import { PageHead } from "@/components/ledger/shared";
import { isConfigured } from "@/lib/ai/client";
import { aiUsage, DAILY_ARCHIVE_QUESTIONS_PER_PERSON } from "@/lib/ai/run";
import { requireMembershipOr404 } from "@/lib/authz";
import { currentBoardYear, listMembers, listYears, loadCalendar, loadPlaybook, loadRecap, memberView, ownerView, PAST_YEARS, yearWindow } from "@/lib/capsule";
import { yearAllowed } from "@/lib/capsule/year";
import { dbToday } from "@/lib/claims";
import { capsulePageSchema } from "@/lib/validation";
import "@/components/ledger/pages.css";
import "@/components/ledger/stats.css";
import "@/components/ledger/capsule/capsule.css";
import { pageTitle } from "../page-title";

export async function generateMetadata({ params }: PageProps<"/[workspaceId]/capsule">): Promise<Metadata> {
  const { workspaceId } = await params;
  return pageTitle(workspaceId, "Time Capsule");
}

// The Time Capsule, for every member. It leads with "Your year in Coppice" (code only, a run of
// full-height pages one press away). Below it, an owner builds the handoff to next year's board as
// six steps, and everyone reads what was published for a board year (read-only, with a year
// switcher) and can ask the archive a question when AI is on. Each part is read by the function
// that decides who may see it (lib/capsule/view.ts), so the page only draws what it is given.

const unwrap = <T,>(result: { ok: true; data: T } | { ok: false; error: string }): T => {
  if (!result.ok) throw new Error(result.error);
  return result.data;
};

export default async function CapsulePage({ params, searchParams }: PageProps<"/[workspaceId]/capsule">) {
  const { workspaceId } = await params;
  const member = await requireMembershipOr404(workspaceId);
  const owner = member.role === "owner";

  // A repeated URL param (?year=a&year=b) arrives as an array; use the first.
  const raw = await searchParams;
  const { year: requested } = capsulePageSchema.parse({ year: [raw.year].flat()[0] ?? null });

  const [current, today] = [await currentBoardYear(), await dbToday()];
  const recap = await loadRecap(member, current);
  const usage = await aiUsage(member);
  const archiveOn = usage.enabled && isConfigured("groq");
  const years = await listYears(member);

  // The board year the capsule section shows. An owner may open this year or one of the last few;
  // an officer only a year that was published.
  const year = owner
    ? requested !== null && yearAllowed(requested, current)
      ? requested
      : current
    : (years.find((y) => y.boardYearStart === requested) ?? years[0])?.boardYearStart ?? current;
  const label = yearWindow(year).label;

  const view = owner ? unwrap(await ownerView(member, year)) : null;
  const members = owner ? unwrap(await listMembers(member)) : [];
  const calendar = owner && view && view.counts.approved > 0 ? unwrap(await loadCalendar(member, view.report.id)) : [];
  const published = await memberView(member, year);
  const playbook = owner || published ? await loadPlaybook(member, year) : null;

  const yearOptions = owner
    ? Array.from({ length: PAST_YEARS + 1 }, (_, i) => current - i).map((y) => {
        const found = years.find((r) => r.boardYearStart === y);
        return { year: y, label: yearWindow(y).label, hint: found ? (found.status === "PUBLISHED" ? "Published" : "Draft") : "Not started" };
      })
    : years.map((y) => ({ year: y.boardYearStart, label: y.label, hint: undefined }));

  const pages = recapPages(recap);
  const { team } = recap;

  return (
    <div className="lg-page-capsule">
      <PageHead title="Time Capsule" sub="Look back on the year, hand it on to the next board, and ask what past boards wrote." />

      <section className="lg-panel lg-cap-hero" aria-labelledby="cap-hero-h" data-tour="capsule-recap-card">
        <div className="lg-cap-herostamp" aria-hidden="true">
          <CapsuleStamp label={recap.year.label} size={112} />
        </div>
        <div className="lg-cap-herobody">
          <p className="lg-cap-kicker">Board of {recap.year.label}</p>
          <h2 id="cap-hero-h" className="lg-cap-herotitle">
            Your year in Coppice
          </h2>
          <p className="lg-muted">
            {recap.empty
              ? "Nothing is logged yet this year, so there is nothing to look back on."
              : `${plural(team.outreachLogged, "outreach entry", "outreach entries")} to ${plural(team.companiesContacted, "company", "companies")} this year. A few pages, one number each.`}
          </p>
          <div className="lg-cap-heroact">
            <RecapReader pages={pages} label={recap.year.label} primary={!owner} />
          </div>
        </div>
      </section>

      {owner && (
        <section id="handoff" className="lg-panel lg-cap-section" aria-labelledby="handoff-h">
          <div className="lg-panel-head">
            <h2 id="handoff-h" className="lg-panel-title">
              Hand off to next year&apos;s board
            </h2>
            <YearMenu workspaceId={workspaceId} value={year} options={yearOptions} />
          </div>
          <div className="lg-panel-body">
            <p className="lg-hint lg-cap-board">
              Board of {label}. {view ? (view.report.status === "PUBLISHED" ? "Published." : "Draft, only owners see it.") : "Not started."}
            </p>
            <Handoff
              key={year}
              workspaceId={workspaceId}
              year={{ start: year, label }}
              view={view}
              members={members}
              calendar={calendar}
              today={today}
              playbook={playbook ? <PlaybookView playbook={playbook} /> : null}
              initialStep={firstStep(view)}
            />
          </div>
        </section>
      )}

      {(published || !owner) && (
        <section id="published" className="lg-panel lg-cap-section" aria-labelledby="published-h">
          <div className="lg-panel-head">
            <h2 id="published-h" className="lg-panel-title">
              {owner ? `What officers see, board of ${label}` : "Handed off by past boards"}
            </h2>
            {!owner && yearOptions.length > 1 && <YearMenu workspaceId={workspaceId} value={year} options={yearOptions} />}
          </div>
          <div className="lg-panel-body">
            {published ? (
              <PublishedCapsule workspaceId={workspaceId} view={published} playbook={playbook} />
            ) : (
              <p className="lg-muted">Nothing has been handed off yet. When an owner publishes a handoff, the approved cards, the playbook and the re-contact calendar appear here.</p>
            )}
          </div>
        </section>
      )}

      <section className="lg-panel lg-cap-section" aria-labelledby="ask-h">
        <div className="lg-panel-head">
          <h2 id="ask-h" className="lg-panel-title">
            Ask the Archive
          </h2>
        </div>
        <div className="lg-panel-body">
          {archiveOn ? (
            <ArchiveAsk workspaceId={workspaceId} perDay={DAILY_ARCHIVE_QUESTIONS_PER_PERSON} />
          ) : (
            <p className="lg-hint">
              {usage.enabled
                ? "Ask the Archive isn't set up on this server yet. Everything else on this page works."
                : "Ask the Archive is hidden while AI is off for this workspace."}
              {owner && !usage.enabled && (
                <>
                  {" "}
                  <Link href={`/${workspaceId}/settings`} className="lg-link">
                    Open Settings
                  </Link>
                  .
                </>
              )}
            </p>
          )}
        </div>
      </section>

      <Disclosure variant="inline" summary="How the capsule is made" className="lg-cap-how">
        <ul className="lg-rules">
          <li>The recap and the playbook are counted by code from your outreach. No AI is involved.</li>
          <li>A relationship card holds facts that code read from your records. Its bullets are written by AI from the notes, and each one is kept only if code finds its quote in the note.</li>
          <li>Officers see a handoff only after an owner publishes it, and only the cards and bullets the owner approved.</li>
          <li>The capsule never changes a company until an owner presses Apply or Reopen for next year.</li>
        </ul>
      </Disclosure>
    </div>
  );
}
