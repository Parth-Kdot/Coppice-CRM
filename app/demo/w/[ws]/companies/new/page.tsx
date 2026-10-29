import type { Metadata } from "next";
import { Suspense } from "react";
import { NewCompanyPage } from "../../../../_ledger/pages/new-company-page";

export const metadata: Metadata = { title: "Add company" };

export default async function Page({ params }: { params: Promise<{ ws: string }> }) {
  const { ws } = await params;
  return (
    <Suspense>
      <NewCompanyPage ws={ws} />
    </Suspense>
  );
}
