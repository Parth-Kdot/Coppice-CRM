"use client";

import Link from "next/link";
import { startTransition, useOptimistic, useState } from "react";
import { releaseDepartingClaims, setDeparting } from "@/app/(app)/[workspaceId]/capsule/actions";
import type { HandoffMember, ReleasedClaims } from "@/lib/capsule";
import { useConfirm } from "../providers";
import { ErrorLine } from "../shared";
import { plural } from "./format";
import { useRun } from "./use-run";

// Step 1, who is leaving. Ticking a person sets their departing mark and nothing else. "Release
// their claims" gives back the companies they hold, so they are free to claim, and says how many.
// It removes nobody: removing a member stays in Settings.

export function StepLeaving({ workspaceId, members }: { workspaceId: string; members: HandoffMember[] }) {
  const confirm = useConfirm();
  const tick = useRun(setDeparting);
  const release = useRun(releaseDepartingClaims);
  const [released, setReleased] = useState<ReleasedClaims | null>(null);
  const [shown, setShown] = useOptimistic(members, (current, change: { userId: string; departing: boolean }) =>
    current.map((m) => (m.userId === change.userId ? { ...m, departingAt: change.departing ? "pending" : null } : m)),
  );
  const leaving = shown.filter((m) => m.departingAt);
  const holding = leaving.reduce((sum, m) => sum + m.claims, 0);

  const toggle = (member: HandoffMember, departing: boolean) => {
    setReleased(null);
    startTransition(async () => {
      setShown({ userId: member.userId, departing });
      await tick.run({ workspaceId, userId: member.userId, departing: departing ? "1" : "0" });
    });
  };

  const onRelease = async () => {
    const names = leaving.filter((m) => m.claims > 0).map((m) => m.name);
    const ok = await confirm({
      message: `Release the ${plural(holding, "company", "companies")} held by ${names.join(", ")}? They become free for anyone to claim. Nobody is removed from the workspace.`,
      confirmLabel: "Release their claims",
    });
    if (!ok) return;
    const result = await release.run({ workspaceId });
    if (result?.ok) setReleased(result.data);
  };

  return (
    <div>
      <h3 className="lg-cap-steph">Who is leaving</h3>
      <p className="lg-muted lg-cap-stepsub">Tick the people who will not be on next year&apos;s board. Ticking changes nothing else.</p>
      <ul className="lg-cap-people">
        {shown.map((m) => (
          <li key={m.userId}>
            <label className="lg-switch lg-cap-person">
              <input type="checkbox" className="lg-check" checked={!!m.departingAt} onChange={(event) => toggle(m, event.target.checked)} aria-describedby={`claims-${m.userId}`} />
              <span className="lg-cap-pname">
                {m.name}
                <span className="lg-hint"> {m.role === "owner" ? "Owner" : "Officer"}, {m.email}</span>
              </span>
            </label>
            <span id={`claims-${m.userId}`} className="lg-hint lg-cap-pclaims">
              {m.claims > 0 ? `Holds ${plural(m.claims, "company", "companies")}` : "Holds nothing"}
            </span>
          </li>
        ))}
      </ul>
      <ErrorLine>{tick.error}</ErrorLine>

      <div className="lg-cap-actionrow">
        <button type="button" className={`lg-btn ${holding > 0 ? "lg-btn-primary" : ""}`} disabled={release.pending || holding === 0} onClick={onRelease}>
          {release.pending ? "Working..." : "Release their claims"}
        </button>
        <p className="lg-hint">
          {leaving.length === 0
            ? "Tick someone first."
            : holding === 0
              ? "Nobody who is leaving holds a company."
              : `${plural(holding, "company is", "companies are")} held by people who are leaving.`}{" "}
          Removing a member stays in{" "}
          <Link href={`/${workspaceId}/settings#members`} className="lg-link">
            Settings
          </Link>
          .
        </p>
      </div>
      <ErrorLine>{release.error}</ErrorLine>
      {released && (
        <p className="lg-cap-done" role="status">
          Released {plural(released.released, "claim", "claims")}
          {released.people.length > 0 && `: ${released.people.map((p) => `${p.name} (${p.released})`).join(", ")}`}.
        </p>
      )}
    </div>
  );
}
