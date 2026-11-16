import Link from "next/link";
import { CheckIcon } from "./icons";

// The queue of a workspace with no companies yet (its heading is the page's h1). An empty queue with zero tiles says nothing about
// how to start, and you cannot log outreach before a company exists, so the whole queue gives way
// to this panel until the first company arrives.
//   Owner: three numbered steps that tick from real data: import a spreadsheet (the main button),
//   or add one company, then invite officers (ticks once a second member or a pending invitation
//   exists).
//   Officer: the same two ways in (anyone can add companies), without the invite step.
// The onboarding tour starts here (data-tour firstrun, firstrun-import, firstrun-add, firstrun-invite).

type Step = { n: number; title: string; body: string; href: string; action: string; done: boolean; primary?: boolean; tour: string };

export function FirstRun({ workspaceId, owner, invited }: { workspaceId: string; owner: boolean; invited: boolean }) {
  const base = `/${workspaceId}`;
  const later = <p className="lg-muted lg-firstrun-later">Once companies are in, the follow-ups that are due show up here.</p>;

  if (!owner) {
    return (
      <section className="lg-firstrun" data-tour="firstrun" aria-labelledby="firstrun-title">
        <h1 id="firstrun-title" className="lg-h1 lg-firstrun-title" tabIndex={-1}>
          No companies yet
        </h1>
        <p className="lg-firstrun-lead">Anyone on the team can add them: import the sponsor spreadsheet, or add one company.</p>
        {later}
        <p className="lg-firstrun-actions">
          <Link href={`${base}/import`} className="lg-btn" data-tour="firstrun-import">
            Import a spreadsheet
          </Link>
          <Link href={`${base}/companies/new`} className="lg-btn lg-btn-primary" data-tour="firstrun-add">
            Add a company
          </Link>
        </p>
      </section>
    );
  }

  const steps: Step[] = [
    { n: 1, title: "Import your spreadsheet", body: "Bring in the sponsor list you already keep.", href: `${base}/import`, action: "Import", done: false, primary: true, tour: "firstrun-import" },
    { n: 2, title: "Or add one company", body: "Start small and add the rest later.", href: `${base}/companies/new`, action: "Add a company", done: false, tour: "firstrun-add" },
    { n: 3, title: "Invite officers", body: "Everyone shares one list and claims who they write to.", href: `${base}/settings#set-members`, action: "Invite", done: invited, tour: "firstrun-invite" },
  ];

  return (
    <section className="lg-firstrun" data-tour="firstrun" aria-labelledby="firstrun-title">
      <h1 id="firstrun-title" className="lg-h1 lg-firstrun-title" tabIndex={-1}>
        Get your sponsor list in
      </h1>
      {later}
      <ol className="lg-firstrun-steps">
        {steps.map((step) => (
          <li key={step.n} className="lg-firstrun-step" data-done={step.done || undefined}>
            <span className="lg-firstrun-n" aria-hidden="true">
              {step.done ? <CheckIcon size={16} /> : step.n}
            </span>
            <div className="lg-firstrun-text">
              <h3 className="lg-firstrun-steptitle">
                {step.title}
                {step.done && <span className="lg-sr"> (done)</span>}
              </h3>
              <p className="lg-muted">{step.body}</p>
            </div>
            <Link href={step.href} className={`lg-btn ${step.primary ? "lg-btn-primary" : ""}`} data-tour={step.tour}>
              {step.action}
              {step.n === 3 && <span className="lg-sr"> officers</span>}
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
