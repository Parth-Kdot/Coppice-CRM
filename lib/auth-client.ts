import { createAuthClient } from "better-auth/react";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";

// Browser-side helper for the things that must start in the browser: the Google redirect,
// signing out, and Allow / Deny when an AI assistant asks to connect. Everything else goes through
// server actions. oauthProviderClient carries a signed assistant sign-in request (in the page's
// query) through Google sign-in and the consent page; on other pages it does nothing.
export const authClient = createAuthClient({ plugins: [oauthProviderClient()] });
