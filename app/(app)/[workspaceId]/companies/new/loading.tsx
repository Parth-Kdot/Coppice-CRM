import { RowsSkeleton } from "@/components/ledger/skeleton";

// Shown at once while the add-company page loads: the heading, then the form box.
export default function NewCompanyLoading() {
  return <RowsSkeleton back title sub panels={1} />;
}
