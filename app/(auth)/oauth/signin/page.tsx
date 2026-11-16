import type { Metadata } from "next";
import Link from "next/link";
import { GoogleSignInButton } from "@/components/auth-buttons";
import { SHOOTS_THREE, Stool } from "@/components/brand/stool";
import "@/components/ledger/ledger.css";
import "@/components/ledger/auth.css";

export const metadata: Metadata = { title: "Sign in to connect an assistant" };

// Where Better Auth sends someone whose AI assistant asked to connect (lib/auth.ts, loginPage)
// while they are signed out. The page's query is the assistant's signed request; the auth client
// sends it along with the Google sign-in, so after Google the flow carries on to the consent
// page instead of the workspace list. Unlike /signin, a signed-in visitor is not sent away: an
// assistant can ask the person to sign in again.
export default function OAuthSignInPage() {
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
        <h1 className="lg-auth-title">Connect an assistant</h1>
        <p className="lg-auth-sub">
          An AI assistant is asking to use your Coppice account. Sign in with Google first; on the next page you see which app it is and
          what it asks for, and you decide.
        </p>
        <GoogleSignInButton />
        <p className="lg-hint max-w-[44ch]">If you didn&apos;t start this from your own assistant, close this page.</p>
        <p className="lg-auth-back">
          <Link href="/" className="lg-link">
            Back to the home page
          </Link>
        </p>
      </main>
    </div>
  );
}
