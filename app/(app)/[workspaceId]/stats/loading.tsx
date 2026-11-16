import { RowsSkeleton } from "@/components/ledger/skeleton";

// Shown at once while template stats load: the heading with its sub line, then three boxed sections.
export default function StatsLoading() {
  return <RowsSkeleton title sub panels={3} />;
}
