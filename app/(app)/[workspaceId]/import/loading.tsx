import { RowsSkeleton } from "@/components/ledger/skeleton";

// Shown at once while the import page loads: the heading with its sub line, then the drop box.
export default function ImportLoading() {
  return <RowsSkeleton title sub panels={1} />;
}
