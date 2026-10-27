import Link from "next/link";
import { demoRoutes } from "@/demo/routes";
import { LogoMark } from "./logo";

// The plain 404 for a workspace the person does not belong to, a company that is not in the
// workspace, or a path that does not exist. The same words for all of them, so ids cannot be probed.
export function NotFoundPage() {
  return (
    <main className="mx-auto flex min-h-[70dvh] max-w-xl flex-col items-center justify-center px-6 py-16 text-center">
      <LogoMark size={56} className="text-moss" />
      <p className="lg-sc mt-6 text-ink-2">404</p>
      <h1 className="lg-h1 mt-1">This page is not in the book</h1>
      <p className="mt-3 text-ink-2">
        The workspace or company does not exist, or you are not a member of it. Both look the same on purpose.
      </p>
      <Link href={demoRoutes.workspaces()} className="lg-btn lg-btn-primary mt-6">
        Back to your workspaces
      </Link>
    </main>
  );
}
