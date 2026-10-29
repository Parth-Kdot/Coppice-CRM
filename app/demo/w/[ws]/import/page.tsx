import type { Metadata } from "next";
import { Suspense } from "react";
import { ImportPage } from "../../../_ledger/pages/import-page";

export const metadata: Metadata = { title: "Import" };

export default async function Page({ params }: { params: Promise<{ ws: string }> }) {
  const { ws } = await params;
  return (
    <Suspense>
      <ImportPage ws={ws} />
    </Suspense>
  );
}
