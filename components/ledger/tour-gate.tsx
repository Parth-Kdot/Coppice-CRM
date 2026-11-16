"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import type { TourName } from "@/lib/onboarding-steps";
import type { TourProps } from "./tour";

// Decides whether the onboarding tour loads at all. The tour itself (tour.tsx and its stylesheet)
// is fetched with next/dynamic only when the basics are due at this full page load, or when the
// account menu asks for a tour with ?tour=basics or ?tour=ai, so ordinary page loads pay nothing.
// The ?tour= request is read here; the tour takes it off the address with its first move.
const Tour = dynamic(() => import("./tour").then((m) => m.Tour), { ssr: false });

export type TourGateProps = Omit<TourProps, "autoStart" | "request"> & {
  // The basics are due for this person in this workspace (lib/onboarding-steps.ts basicsPending).
  pending: boolean;
};

export function TourGate({ pending, ...props }: TourGateProps) {
  const params = useSearchParams();
  const asked = params.get("tour");
  const tour: TourName | null = asked === "basics" || asked === "ai" ? asked : null;

  // Due at the first load only: once the layout is up, a later change never opens it by itself.
  const [autoStart] = useState(pending);
  const [request, setRequest] = useState<{ tour: TourName; id: number } | null>(null);
  const [seen, setSeen] = useState<TourName | null>(null);
  if (tour !== seen) {
    setSeen(tour);
    if (tour) setRequest({ tour, id: (request?.id ?? 0) + 1 });
  }

  if (!autoStart && !request) return null;
  return <Tour {...props} autoStart={autoStart} request={request} />;
}
