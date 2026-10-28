import type { Metadata } from "next";
import { SignInScreen } from "../_ledger/screens/signin";

export const metadata: Metadata = { title: "Sign in · Coppice" };

export default function SignInPage() {
  return <SignInScreen />;
}
