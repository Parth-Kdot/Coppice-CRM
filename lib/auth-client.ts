import { createAuthClient } from "better-auth/react";

// Browser-side helper for the two things that must start in the browser:
// the Google redirect and signing out. Everything else goes through server actions.
export const authClient = createAuthClient();
