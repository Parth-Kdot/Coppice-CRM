import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { GoogleSignInButton } from "@/components/auth-buttons";
import { auth } from "@/lib/auth";

export default async function SignInPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) redirect("/workspaces");

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-8">
      <h1 className="text-2xl font-semibold">BoilerPitch</h1>
      <p>Your org&apos;s shared sponsorship pipeline. Sign in to continue.</p>
      <GoogleSignInButton />
    </main>
  );
}
