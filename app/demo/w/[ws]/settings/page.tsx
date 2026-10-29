import type { Metadata } from "next";
import { Suspense } from "react";
import { SettingsPage } from "../../../_ledger/pages/settings-page";

export const metadata: Metadata = { title: "Settings" };

export default async function Page({ params }: { params: Promise<{ ws: string }> }) {
  const { ws } = await params;
  return (
    <Suspense>
      <SettingsPage ws={ws} />
    </Suspense>
  );
}
