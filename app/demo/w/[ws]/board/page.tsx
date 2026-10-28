import type { Metadata } from "next";
import { Suspense } from "react";
import { BoardScreen } from "../../../_ledger/screens/board";

export const metadata: Metadata = { title: "Board · Coppice" };

export default async function BoardPage({ params }: { params: Promise<{ ws: string }> }) {
  const { ws } = await params;
  return (
    <Suspense>
      <BoardScreen ws={ws} />
    </Suspense>
  );
}
