"use client";

import { CsvImporter } from "@/components/ledger/csv-importer";
import { PageHead } from "@/components/ledger/shared";
import "@/components/ledger/pages.css";
import { useFormActions } from "../form-actions";
import { SAMPLE_CSV, SAMPLE_CSV_FILENAME } from "@/demo/sample-csv";

// Import: the real screen. The demo adds one small link that downloads the sample file, so a
// visitor has a CSV to pick.
export function ImportPage({ ws }: { ws: string }) {
  const a = useFormActions();
  return (
    <div className="lg-page-import">
      <PageHead
        title="Import companies"
        sub="Upload a .csv file with a header row: up to 2,000 rows and 3 MB. In Google Sheets: File, Download, Comma-separated values. Companies are added as Not contacted, with at most one contact each."
      >
        <a className="lg-btn" href={`data:text/csv;charset=utf-8,${encodeURIComponent(SAMPLE_CSV)}`} download={SAMPLE_CSV_FILENAME}>
          Get the sample CSV
        </a>
      </PageHead>
      <CsvImporter workspaceId={ws} preview={a.previewImport as never} run={a.runImport as never} />
    </div>
  );
}
