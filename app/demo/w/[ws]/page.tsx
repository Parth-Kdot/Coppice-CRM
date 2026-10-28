import type { Metadata } from "next";
import { Suspense } from "react";
import { QueueScreen } from "../../_ledger/screens/queue";

export const metadata: Metadata = { title: "Queue · Coppice" };

export default async function QueuePage({ params }: { params: Promise<{ ws: string }> }) {
  const { ws } = await params;
  return (
    <Suspense>
      <QueueScreen ws={ws} />
    </Suspense>
  );
}
