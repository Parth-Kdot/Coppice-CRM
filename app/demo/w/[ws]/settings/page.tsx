import type { Metadata } from "next";
import { SettingsScreen } from "../../../_ledger/screens/settings";

export const metadata: Metadata = { title: "Settings · Coppice" };

export default async function SettingsPage({ params }: { params: Promise<{ ws: string }> }) {
  const { ws } = await params;
  return <SettingsScreen ws={ws} />;
}
