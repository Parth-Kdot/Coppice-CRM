"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { demoRoutes } from "@/demo/routes";
import { useDemoActions } from "@/demo/store";
import { Ribbon } from "../marks";
import { SHOOTS_THREE, Stool } from "../stool";
import { Wordmark } from "../logo";

// Sign-in: a single page of the ledger with the stool, and one moss button. The prototype's button
// shows "Redirecting to Google..." for a moment, then goes to the workspace list.
export function SignInScreen() {
  const router = useRouter();
  const actions = useDemoActions();
  const [going, setGoing] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const go = () => {
    setGoing(true);
    timer.current = window.setTimeout(() => {
      actions.signIn();
      router.push(demoRoutes.workspaces());
    }, 650);
  };

  return (
    <div className="lg-auth">
      <a className="lg-skip" href="#main">
        Skip to the page
      </a>
      <main id="main" className="lg-auth-page lg-page-enter">
        <Ribbon size="lg" className="lg-auth-ribbon" />
        <Stool shoots={SHOOTS_THREE} className="lg-auth-stool" />
        <h1 className="lg-auth-title">
          <Wordmark />
        </h1>
        <p className="lg-auth-sub">Your org&apos;s shared sponsorship pipeline. Sign in to continue.</p>
        <button type="button" className="lg-btn lg-btn-primary lg-auth-btn" onClick={go} disabled={going}>
          {going ? "Redirecting to Google..." : "Sign in with Google"}
        </button>
        <p className="lg-hint mt-4">
          <Link href={demoRoutes.landing()} className="lg-link">
            Back to the home page
          </Link>
        </p>
      </main>
    </div>
  );
}
