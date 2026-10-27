import { FactsScreen } from "../../../_ledger/screens/facts";

export default async function FactsPage({ params }: { params: Promise<{ ws: string }> }) {
  const { ws } = await params;
  return <FactsScreen ws={ws} />;
}
