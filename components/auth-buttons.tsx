"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ErrorLine } from "@/components/ledger/shared";
import { authClient } from "@/lib/auth-client";

// The Google mark, in Google's own colors, as the sign-in button shows it.
function GoogleMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" />
      <path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 0 1 0-9.4l-7.9-6.1a24 24 0 0 0 0 21.6l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}

export function GoogleSignInButton({ className = "" }: { className?: string }) {
  const [going, setGoing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setGoing(true);
    setError(null);
    try {
      const result = await authClient.signIn.social({ provider: "google", callbackURL: "/workspaces" });
      // On success the browser is already on its way to Google; only a refusal comes back here.
      if (result?.error) {
        setError("Google sign-in could not start. Try again in a moment.");
        setGoing(false);
      }
    } catch {
      setError("Google sign-in could not start. Check your connection and try again.");
      setGoing(false);
    }
  }

  return (
    <div className={className}>
      <button type="button" className="lg-btn lg-google" onClick={start} disabled={going}>
        <GoogleMark />
        {going ? "Opening Google..." : "Sign in with Google"}
      </button>
      <ErrorLine>{error}</ErrorLine>
    </div>
  );
}

export function SignOutButton({ label = "Sign out", className = "lg-btn" }: { label?: string; className?: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        await authClient.signOut();
        router.push("/signin");
      }}
    >
      {label}
    </button>
  );
}
