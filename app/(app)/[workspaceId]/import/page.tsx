import Link from "next/link";
import { CsvImporter } from "@/components/csv-importer";
import { requireMembershipOr404 } from "@/lib/authz";
import { previewImport, runImport } from "./actions";

export default async function ImportPage({ params }: PageProps<"/[workspaceId]/import">) {
  const { workspaceId } = await params;
  await requireMembershipOr404(workspaceId);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-8">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Import companies</h1>
        <Link href={`/${workspaceId}`} className="rounded border px-3 py-1">
          Back
        </Link>
      </header>
      <p className="text-sm text-zinc-500">
        Upload a .csv file with a header row: up to 2,000 rows and 3 MB. In Google Sheets: File, Download, Comma-separated values.
        Companies are added as Not contacted, with at most one contact each.
      </p>
      <CsvImporter workspaceId={workspaceId} preview={previewImport} run={runImport} />
    </div>
  );
}
