import { NewCompanyScreen } from "../../../../_ledger/screens/new-company";

export default async function NewCompanyPage({ params }: { params: Promise<{ ws: string }> }) {
  const { ws } = await params;
  return <NewCompanyScreen ws={ws} />;
}
