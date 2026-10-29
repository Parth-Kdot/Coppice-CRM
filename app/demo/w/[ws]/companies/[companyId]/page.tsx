import type { Metadata } from "next";
import { Suspense } from "react";
import { CompanyPage } from "../../../../_ledger/pages/company-page";

export const metadata: Metadata = { title: "Company" };

export default async function Page({ params }: { params: Promise<{ ws: string; companyId: string }> }) {
  const { ws, companyId } = await params;
  return (
    <Suspense>
      <CompanyPage ws={ws} companyId={companyId} />
    </Suspense>
  );
}
