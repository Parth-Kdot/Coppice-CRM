import type { Metadata } from "next";
import { Suspense } from "react";
import { QueuePage } from "../../_ledger/pages/queue-page";

export const metadata: Metadata = { title: "Queue" };

export default async function Page({ params }: { params: Promise<{ ws: string }> }) {
  const { ws } = await params;
  return (
    <Suspense>
      <QueuePage ws={ws} />
    </Suspense>
  );
}
