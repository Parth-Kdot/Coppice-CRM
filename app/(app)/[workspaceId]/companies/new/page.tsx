import type { Metadata } from "next";
import Link from "next/link";
import { CompanyForm } from "@/components/company-form";
import { PageHead } from "@/components/ledger/shared";
import { requireMembershipOr404 } from "@/lib/authz";
import { listIndustries } from "@/lib/companies";
import { createCompany, unarchiveCompany } from "../actions";
import "@/components/ledger/company.css";
import { pageTitle } from "../../page-title";

export async function generateMetadata({ params }: PageProps<"/[workspaceId]/companies/new">): Promise<Metadata> {
  const { workspaceId } = await params;
  return pageTitle(workspaceId, "Add company");
}

// Add one company by hand. Look-alikes, archived ones included, are shown before anything is saved:
// open the existing one, bring an archived one back, or keep both as separate entries.
export default async function NewCompanyPage({ params }: PageProps<"/[workspaceId]/companies/new">) {
  const { workspaceId } = await params;
  const { userId } = await requireMembershipOr404(workspaceId);
  const industries = await listIndustries({ userId, workspaceId });

  return (
    <div className="lg-sheetwrap">
      <PageHead title="Add a company" sub="Check the name against the workspace first: a look-alike is shown before anything is saved.">
        <Link href={`/${workspaceId}`} className="lg-btn">
          Back
        </Link>
      </PageHead>
      <CompanyForm mode="create" workspaceId={workspaceId} industries={industries} save={createCompany} unarchive={unarchiveCompany} />
    </div>
  );
}
