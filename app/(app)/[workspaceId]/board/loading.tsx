import { RowsSkeleton } from "@/components/ledger/skeleton";

// Shown at once while the board loads: five ruled columns of placeholder slips.
export default function BoardLoading() {
  return <RowsSkeleton title columns={5} rows={8} />;
}
