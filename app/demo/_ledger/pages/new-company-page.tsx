"use client";
import "@/components/ledger/zod-jitless";

import Link from "next/link";
import { CompanyForm } from "@/components/ledger/company-form";
import { PageHead } from "@/components/ledger/shared";
import "@/components/ledger/company.css";
import { useIndustries } from "@/demo/store";
import { useFormActions } from "../form-actions";

export function NewCompanyPage({ ws }: { ws: string }) {
  const a = useFormActions();
  const industries = useIndustries(ws);
  return (
    <div className="lg-sheetwrap">
      <PageHead title="Add a company" sub="Check the name against the workspace first: a look-alike is shown before anything is saved.">
        <Link href={`/demo/w/${ws}`} className="lg-btn">
          Back
        </Link>
      </PageHead>
      <CompanyForm mode="create" workspaceId={ws} industries={industries} save={a.createCompany} unarchive={a.unarchiveCompany} />
    </div>
  );
}
