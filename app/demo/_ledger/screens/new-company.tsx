"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { demoRoutes } from "@/demo/routes";
import { useDemoActions, useIndustries } from "@/demo/store";
import { COMPANY_LIMITS } from "@/demo/validation";
import { DuplicateIcon } from "../icons";
import { useNotify } from "../providers";
import { IndustryField } from "./industry-field";
import { ErrorLine, PageHead } from "./shared";

type Match = { id: string; name: string; website: string | null; archived: boolean; matchedOn: ("name" | "website")[] };

// Add one company by hand. Look-alikes, archived ones included, are shown before anything is saved:
// open the existing one, bring an archived one back, or keep both as separate entries.
export function NewCompanyScreen({ ws }: { ws: string }) {
  const router = useRouter();
  const actions = useDemoActions();
  const notify = useNotify();
  const industries = useIndustries(ws);
  const id = useId();
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("");
  const [website, setWebsite] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [boxError, setBoxError] = useState<string | null>(null);

  const save = (separateFrom?: string[]) => {
    setError(null);
    setBoxError(null);
    const result = actions.createCompany(ws, { name, industry, website, notes }, separateFrom);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (result.data.status === "possible-duplicates") {
      setMatches(result.data.matches);
      return;
    }
    if (result.data.status === "saved") {
      notify(`${name.trim()} added.`);
      router.push(demoRoutes.company(ws, result.data.companyId));
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setMatches(null);
    save();
  };

  return (
    <div className="lg-new">
      <PageHead title="Add a company">
        <Link href={demoRoutes.queue(ws)} className="lg-btn">
          Back
        </Link>
      </PageHead>

      <form onSubmit={onSubmit} className="lg-leaf-page lg-sheet lg-newform" aria-label="Add a company">
        <div>
          <label className="lg-label" htmlFor={`${id}-name`}>
            Name
          </label>
          <input id={`${id}-name`} className="lg-input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <p className="lg-hint">Required, up to {COMPANY_LIMITS.name} characters.</p>
        </div>
        <div className="lg-row2">
          <IndustryField value={industry} onChange={setIndustry} suggestions={industries} />
          <div>
            <label className="lg-label" htmlFor={`${id}-website`}>
              Website
            </label>
            <input id={`${id}-website`} className="lg-input" placeholder="acme.com" value={website} onChange={(e) => setWebsite(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="lg-label" htmlFor={`${id}-notes`}>
            Notes
          </label>
          <textarea id={`${id}-notes`} className="lg-textarea" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div className="lg-actions">
          <button type="submit" className="lg-btn lg-btn-primary">
            Add company
          </button>
        </div>
        <ErrorLine>{error}</ErrorLine>

        {matches && (
          <div className="lg-warn-box" role="alert">
            <p className="font-semibold">This looks like a company already in the workspace:</p>
            <ul className="lg-matches">
              {matches.map((m) => (
                <li key={m.id}>
                  <Link href={demoRoutes.company(ws, m.id)} className="lg-link font-semibold">
                    {m.name}
                  </Link>
                  <span className="lg-muted">
                    {m.website ? `, ${m.website}` : ""} ({m.matchedOn.length === 2 ? "same name and website" : m.matchedOn[0] === "website" ? "same website" : "same name"})
                  </span>
                  {m.archived && <span className="lg-badge lg-badge-stale ml-2">archived</span>}
                  <div className="mt-2">
                    {m.archived ? (
                      <button
                        type="button"
                        className="lg-btn lg-btn-sm"
                        onClick={() => {
                          const r = actions.unarchiveCompany(ws, m.id);
                          if (!r.ok) setBoxError(r.error);
                          else {
                            notify(`${m.name} is back, with its history.`);
                            router.push(demoRoutes.company(ws, m.id));
                          }
                        }}
                      >
                        <DuplicateIcon size={16} />
                        Same company: unarchive it instead
                      </button>
                    ) : (
                      <Link href={demoRoutes.company(ws, m.id)} className="lg-btn lg-btn-sm">
                        <DuplicateIcon size={16} />
                        Same company: open it
                      </Link>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <ErrorLine>{boxError}</ErrorLine>
            <button type="button" className="lg-btn mt-3" onClick={() => save(matches.map((m) => m.id))}>
              Separate entries: save anyway
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
