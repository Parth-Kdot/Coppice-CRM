import { RowsSkeleton } from "@/components/ledger/skeleton";

// Shown at once while the fact sheet loads: the heading with its sub line, then two boxed sections.
export default function FactsLoading() {
  return <RowsSkeleton title sub panels={2} narrow />;
}
