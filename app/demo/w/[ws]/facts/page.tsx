import type { Metadata } from "next";
import { Suspense } from "react";
import { FactsPage } from "../../../_ledger/pages/facts-page";

export const metadata: Metadata = { title: "Fact sheet" };

export default async function Page({ params }: { params: Promise<{ ws: string }> }) {
  const { ws } = await params;
  return (
    <Suspense>
      <FactsPage ws={ws} />
    </Suspense>
  );
}
