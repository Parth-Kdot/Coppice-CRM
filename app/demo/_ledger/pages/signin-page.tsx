"use client";
import "@/components/ledger/zod-jitless";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SHOOTS_THREE, Stool } from "@/components/ledger/stool";
import { useDemoActions } from "@/demo/store";
import "@/components/ledger/ledger.css";
import "@/components/ledger/auth.css";

// The sign-in page, as the real one looks. There is no Google here: the button opens the demo.
export function SignInPage() {
  const router = useRouter();
  const actions = useDemoActions();
  const [going, setGoing] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const go = () => {
    setGoing(true);
    timer.current = window.setTimeout(() => {
      actions.signIn();
      router.push("/demo/workspaces");
    }, 400);
  };

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
        <p className="lg-auth-sub">Your team&apos;s shared outreach book. This is a demo on sample data: no account, nothing is saved.</p>
        <div>
          <button type="button" className="lg-btn lg-btn-primary ld-btn-lg" onClick={go} disabled={going}>
            {going ? "Opening the demo..." : "Open the demo"}
          </button>
        </div>
        <p className="lg-auth-back">
          <Link href="/" className="lg-link">
            Back to the home page
          </Link>
        </p>
      </main>
    </div>
  );
}
