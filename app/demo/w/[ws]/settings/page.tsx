import { SettingsScreen } from "../../../_ledger/screens/settings";

export default async function SettingsPage({ params }: { params: Promise<{ ws: string }> }) {
  const { ws } = await params;
  return <SettingsScreen ws={ws} />;
}
