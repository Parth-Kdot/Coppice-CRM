import type { Metadata } from "next";
import Link from "next/link";
import { AskScreen } from "@/components/ledger/ask/ask-screen";
import { PageHead } from "@/components/ledger/shared";
import { AI_OFF_MESSAGE } from "@/lib/ai/run";
import { requireMembershipOr404 } from "@/lib/authz";
import { dbToday } from "@/lib/claims";
import { copilotStatus, openThread, STARTER_CHIPS } from "@/lib/copilot";
import "@/components/ledger/ask.css";
import { pageTitle } from "../page-title";

export async function generateMetadata({ params }: PageProps<"/[workspaceId]/ask">): Promise<Metadata> {
  const { workspaceId } = await params;
  return pageTitle(workspaceId, "Ask Coppice");
}

// Ask Coppice: a question about the pipeline, or about how Coppice works, answered with a sentence,
// editable filter chips, rows read from the workspace by code, and confirm cards for anything it
// proposes. The model sees only the question, the last few questions and the names of the companies
// just shown (lib/copilot/prompt.ts); everything on screen is read by code (lib/copilot/). This page
// loads the person's latest conversation; the rest happens in the browser through ./actions.ts. A
// question from the search palette arrives as ?q= and the screen asks it once.
// With AI off for the workspace the page says so and nothing else (the links to it are hidden too).
export default async function AskPage({ params }: PageProps<"/[workspaceId]/ask">) {
  const { workspaceId } = await params;
  const member = await requireMembershipOr404(workspaceId);
  const status = await copilotStatus(member);

  if (!status.aiOn) {
    return (
      <div className="lg-page-ask">
        <PageHead title="Ask Coppice" />
        <p className="lg-ask-off">
          {AI_OFF_MESSAGE}
          {member.role === "owner" && (
            <>
              {" "}
              <Link href={`/${workspaceId}/settings`} className="lg-link">
                Open Settings
              </Link>
            </>
          )}
        </p>
      </div>
    );
  }

  const [opened, today] = await Promise.all([openThread(member), dbToday()]);
  return (
    <AskScreen
      workspaceId={workspaceId}
      today={today}
      groqConfigured={status.groqConfigured}
      threadId={opened.threadId}
      turns={opened.turns}
      latest={opened.latest}
      starters={STARTER_CHIPS}
    />
  );
}
