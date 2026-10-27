import { ImportScreen } from "../../../_ledger/screens/import";

export default async function ImportPage({ params }: { params: Promise<{ ws: string }> }) {
  const { ws } = await params;
  return <ImportScreen ws={ws} />;
}
