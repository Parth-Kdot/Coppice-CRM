import type { Metadata } from "next";
import { CsvImporter } from "@/components/csv-importer";
import { PageHead } from "@/components/ledger/shared";
import { requireMembershipOr404 } from "@/lib/authz";
import { smartOptions } from "@/lib/smart-import";
import { previewImport, runImport } from "./actions";
import { readSmartChunk, runSmartImport, startSmartRead, suggestColumns } from "./smart-actions";
import "@/components/ledger/pages.css";
import { pageTitle } from "../page-title";

export async function generateMetadata({ params }: PageProps<"/[workspaceId]/import">): Promise<Metadata> {
  const { workspaceId } = await params;
  return pageTitle(workspaceId, "Import");
}

// Smart import's AI calls run in the page's server actions; the overall AI deadline is 100 s.
export const maxDuration = 120;

// Import: any member may add companies from a spreadsheet. Drop a file, check what it will do,
// import; the server checks the file again at every step.
export default async function ImportPage({ params }: PageProps<"/[workspaceId]/import">) {
  const { workspaceId } = await params;
  const me = await requireMembershipOr404(workspaceId);
  // Smart import is only offered while AI is on for the workspace (its actions refuse otherwise).
  const options = await smartOptions(me);
  const smart = options.aiOn ? { options, suggest: suggestColumns, start: startSmartRead, read: readSmartChunk, run: runSmartImport } : undefined;

  return (
    <div className="lg-page-import">
      <PageHead title="Import companies" sub="Add companies from a .csv file (up to 2,000 rows)." />
      <CsvImporter workspaceId={workspaceId} preview={previewImport} run={runImport} smart={smart} />
    </div>
  );
}
