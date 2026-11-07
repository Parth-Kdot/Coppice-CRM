import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { GoogleSignInButton } from "@/components/auth-buttons";
import { SHOOTS_THREE, Stool } from "@/components/ledger/stool";
import { auth } from "@/lib/auth";
import { safeNextPath } from "@/lib/validation";
import "@/components/ledger/ledger.css";
import "@/components/ledger/auth.css";

export const metadata: Metadata = { title: "Sign in" };

// ?next= is the page someone opened while signed out (lib/authz.ts requireUser): a path on this
// site only, checked again here, and handed to Google as the place to come back to.
export default async function SignInPage({ searchParams }: PageProps<"/signin">) {
  const next = safeNextPath((await searchParams).next) ?? "/workspaces";
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) redirect(next);

  return (
    <div className="lg-auth">
      <a className="lg-skip" href="#main">
        Skip to the page
      </a>
      <div className="lg-auth-art" aria-hidden="true">
        <Stool shoots={SHOOTS_THREE} className="lg-auth-stool" />
        <p className="lg-auth-line">New board, same roots.</p>
      </div>
      <main id="main" tabIndex={-1} className="lg-auth-main lg-page-enter">
        <h1 className="lg-auth-title">Coppice</h1>
        <p className="lg-auth-sub">Your team&apos;s shared outreach book. Sign in with Google to open it.</p>
        <GoogleSignInButton next={next} />
        <p className="lg-auth-who">Officers: your chair invites your Google email first.</p>
        <p className="lg-auth-back">
          <Link href="/" className="lg-link">
            Back to the home page
          </Link>
        </p>
      </main>
    </div>
  );
}
