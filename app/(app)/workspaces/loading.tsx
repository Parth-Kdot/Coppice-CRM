import Link from "next/link";
import { LogoMark } from "@/components/brand/logo";
import { RowsSkeleton } from "@/components/ledger/skeleton";
import "@/components/ledger/ledger.css";
import "@/components/ledger/auth.css";

// Shown at once while the workspace list loads: the logo where it will be, then the heading and
// a few card-height rows. The name and Sign out arrive with the page.
export default function WorkspacesLoading() {
  return (
    <div className="lg-wslist">
      <header className="lg-wshead">
        <Link href="/" className="lg-wslogo" aria-label="Coppice, home">
          <LogoMark size={40} />
          <span className="font-display text-[length:var(--fs-4)] font-medium tracking-[0.01em] text-ink">Coppice</span>
        </Link>
      </header>
      <div className="lg-double-rule" />
      <main className="lg-wsmain">
        <RowsSkeleton title sub rows={3} />
      </main>
    </div>
  );
}
