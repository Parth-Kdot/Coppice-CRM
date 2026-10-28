import type { Metadata } from "next";
import { ImportScreen } from "../../../_ledger/screens/import";

export const metadata: Metadata = { title: "Import · Coppice" };

export default async function ImportPage({ params }: { params: Promise<{ ws: string }> }) {
  const { ws } = await params;
  return <ImportScreen ws={ws} />;
}
