"use client";

import { useState } from "react";
import { ErrorLine } from "@/components/ledger/shared";
import { authClient } from "@/lib/auth-client";

// Allow / Deny on the consent page. The auth client sends the page's signed request along
// (oauthProviderClient), and Better Auth answers with where to go next: back to the assistant
// with a code, or with "access denied".
export function ConsentButtons({ clientName }: { clientName: string }) {
  const [going, setGoing] = useState<"allow" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function answer(accept: boolean) {
    setGoing(accept ? "allow" : "deny");
    setError(null);
    try {
      const { data, error: refused } = await authClient.oauth2.consent({ accept });
      const next = (data as { redirect_uri?: string; url?: string } | null)?.redirect_uri ?? (data as { url?: string } | null)?.url;
      if (refused || !next) {
        setError("This request has expired. Go back to your assistant and connect again.");
        setGoing(null);
        return;
      }
      window.location.assign(next);
    } catch {
      setError("Coppice couldn't be reached. Check your connection and try again.");
      setGoing(null);
    }
  }

  return (
    <div className="lg-consent-acts">
      <button type="button" className="lg-btn lg-btn-primary" disabled={going !== null} onClick={() => answer(true)}>
        {going === "allow" ? (
          "Connecting..."
        ) : (
          <>
            Allow{" "}
            <span className="lg-trunc" title={clientName}>
              <bdi>{clientName}</bdi>
            </span>
          </>
        )}
      </button>
      <button type="button" className="lg-btn" disabled={going !== null} onClick={() => answer(false)}>
        {going === "deny" ? "Saying no..." : "Deny"}
      </button>
      <ErrorLine>{error}</ErrorLine>
    </div>
  );
}
