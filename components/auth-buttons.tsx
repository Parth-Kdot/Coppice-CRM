"use client";

import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export function GoogleSignInButton() {
  return (
    <button
      type="button"
      className="rounded border px-4 py-2"
      onClick={() => authClient.signIn.social({ provider: "google", callbackURL: "/workspaces" })}
    >
      Sign in with Google
    </button>
  );
}

export function SignOutButton({ label = "Sign out" }: { label?: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className="rounded border px-3 py-1"
      onClick={async () => {
        await authClient.signOut();
        router.push("/signin");
      }}
    >
      {label}
    </button>
  );
}
