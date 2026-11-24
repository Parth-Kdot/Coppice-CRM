import { RowsSkeleton } from "@/components/ledger/skeleton";

// Shown at once while a company page loads (its data is one transaction, but a long history takes
// a moment): a bar for the way back and the one tall box the company sits in, name inside it.
export default function Loading() {
  return <RowsSkeleton back card />;
}
