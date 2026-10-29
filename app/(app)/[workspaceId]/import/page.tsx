import Link from "next/link";
import { CsvImporter } from "@/components/csv-importer";
import { PageHead } from "@/components/ledger/shared";
import { requireMembershipOr404 } from "@/lib/authz";
import { previewImport, runImport } from "./actions";
import "@/components/ledger/pages.css";

// Import: any member may add companies from a spreadsheet. The steps run in one ledger of numbered
// entries; the server checks the file again at every step.
export default async function ImportPage({ params }: PageProps<"/[workspaceId]/import">) {
  const { workspaceId } = await params;
  await requireMembershipOr404(workspaceId);

  return (
    <div className="lg-page-import">
      <PageHead
        title="Import companies"
        sub="Upload a .csv file with a header row: up to 2,000 rows and 3 MB. In Google Sheets: File, Download, Comma-separated values. Companies are added as Not contacted, with at most one contact each."
      >
        <Link href={`/${workspaceId}`} className="lg-btn">
          Back
        </Link>
      </PageHead>
      <CsvImporter workspaceId={workspaceId} preview={previewImport} run={runImport} />
    </div>
  );
}
