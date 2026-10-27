import { Suspense } from "react";
import { CompanyScreen } from "../../../../_ledger/screens/company";

export default async function CompanyPage({ params }: { params: Promise<{ ws: string; companyId: string }> }) {
  const { ws, companyId } = await params;
  return (
    <Suspense>
      <CompanyScreen ws={ws} companyId={companyId} />
    </Suspense>
  );
}
