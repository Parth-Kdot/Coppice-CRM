import type { Metadata } from "next";
import { Suspense } from "react";
import { BoardPage } from "../../../_ledger/pages/board-page";

export const metadata: Metadata = { title: "Board" };

export default async function Page({ params }: { params: Promise<{ ws: string }> }) {
  const { ws } = await params;
  return (
    <Suspense>
      <BoardPage ws={ws} />
    </Suspense>
  );
}
