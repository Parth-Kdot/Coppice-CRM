import { RowsSkeleton } from "@/components/ledger/skeleton";

// Shown at once while Settings load: the heading, then the member rows and the folded sections as ruled rows.
export default function SettingsLoading() {
  return <RowsSkeleton title rows={9} />;
}
