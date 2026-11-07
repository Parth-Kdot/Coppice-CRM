import { RowsSkeleton } from "@/components/ledger/skeleton";

// Shown at once while a company page loads (its data is one transaction, but a long history takes
// a moment): the ruled-row skeleton with a title bar.
export default function Loading() {
  return <RowsSkeleton rows={8} title />;
}
