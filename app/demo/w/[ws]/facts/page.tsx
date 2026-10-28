import type { Metadata } from "next";
import { FactsScreen } from "../../../_ledger/screens/facts";

export const metadata: Metadata = { title: "Fact sheet · Coppice" };

export default async function FactsPage({ params }: { params: Promise<{ ws: string }> }) {
  const { ws } = await params;
  return <FactsScreen ws={ws} />;
}
