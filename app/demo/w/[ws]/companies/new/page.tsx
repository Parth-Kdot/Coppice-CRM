import type { Metadata } from "next";
import { NewCompanyScreen } from "../../../../_ledger/screens/new-company";

export const metadata: Metadata = { title: "Add a company · Coppice" };

export default async function NewCompanyPage({ params }: { params: Promise<{ ws: string }> }) {
  const { ws } = await params;
  return <NewCompanyScreen ws={ws} />;
}
