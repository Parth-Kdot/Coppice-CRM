import type { Metadata } from "next";
import { SignInPage } from "../_ledger/pages/signin-page";

export const metadata: Metadata = { title: "Sign in" };

export default function Page() {
  return <SignInPage />;
}
