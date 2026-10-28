"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { DEMO_WORKSPACE_SUMMARIES } from "@/demo/data";
import { demoRoutes } from "@/demo/routes";
import { useDemoActions } from "@/demo/store";
import { useLedgerTools, useNotify } from "./providers";

// Reset demo: puts every workspace back as it started, clears the reviewer switches and goes back
// to the queue (or the workspace list when this workspace is not part of the sample data).
export function useResetDemo(ws: string): () => void {
  const actions = useDemoActions();
  const router = useRouter();
  const notify = useNotify();
  const { setRaceNext } = useLedgerTools();
  return useCallback(() => {
    actions.resetDemo();
    setRaceNext(false);
    notify("The demo is back to Oct 28, 2026.");
    const stillThere = DEMO_WORKSPACE_SUMMARIES.some((w) => w.id === ws);
    router.push(stillThere ? demoRoutes.queue(ws) : demoRoutes.workspaces());
  }, [actions, notify, router, setRaceNext, ws]);
}
