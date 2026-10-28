import { Suspense } from "react";
import { CompaniesScreen } from "../../../_ledger/screens/companies";

export default async function CompaniesPage({ params }: { params: Promise<{ ws: string }> }) {
  const { ws } = await params;
  return (
    <Suspense>
      <CompaniesScreen ws={ws} />
    </Suspense>
  );
}
