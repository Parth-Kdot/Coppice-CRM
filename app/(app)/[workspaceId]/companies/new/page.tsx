import type { Metadata } from "next";
import { CompanyForm } from "@/components/company-form";
import { ChevronLeftIcon } from "@/components/ledger/icons";
import { PageHead } from "@/components/ledger/shared";
import { BackToList } from "@/components/ledger/shell";
import { requireMembershipOr404 } from "@/lib/authz";
import { listIndustries } from "@/lib/companies";
import { createCompany, unarchiveCompany } from "../actions";
import "@/components/ledger/company.css";
import { pageTitle } from "../../page-title";

export async function generateMetadata({ params }: PageProps<"/[workspaceId]/companies/new">): Promise<Metadata> {
  const { workspaceId } = await params;
  return pageTitle(workspaceId, "Add a company");
}

// Add one company by hand. Look-alikes, archived ones included, are shown before anything is saved:
// open the existing one, bring an archived one back, or keep both as separate entries.
export default async function NewCompanyPage({ params }: PageProps<"/[workspaceId]/companies/new">) {
  const { workspaceId } = await params;
  const { userId } = await requireMembershipOr404(workspaceId);
  const industries = await listIndustries({ userId, workspaceId });

  return (
    <div className="lg-sheetwrap">
      {/* The same way back as a company page: above the heading, to the list you came from. */}
      <BackToList workspaceId={workspaceId} className="lg-back" icon={<ChevronLeftIcon size={18} />} />
      <PageHead title="Add a company" sub="We check for look-alikes before saving." />
      <CompanyForm mode="create" workspaceId={workspaceId} industries={industries} save={createCompany} unarchive={unarchiveCompany} />
    </div>
  );
}
