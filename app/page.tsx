import { headers } from "next/headers";
import { Landing } from "@/components/landing/landing";
import { auth } from "@/lib/auth";

// The landing page. A visitor who is already signed in sees the same page with its buttons
// pointing at their workspaces instead of at sign-in.
export default async function Home() {
  const session = await auth.api.getSession({ headers: await headers() });
  return <Landing signedIn={Boolean(session)} />;
}
