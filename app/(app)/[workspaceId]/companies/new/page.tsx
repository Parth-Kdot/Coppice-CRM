import Link from "next/link";
import { CompanyForm } from "@/components/company-form";
import { requireMembershipOr404 } from "@/lib/authz";
import { listIndustries } from "@/lib/companies";
import { createCompany, unarchiveCompany } from "../actions";

export default async function NewCompanyPage({ params }: PageProps<"/[workspaceId]/companies/new">) {
  const { workspaceId } = await params;
  const { userId } = await requireMembershipOr404(workspaceId);
  const industries = await listIndustries({ userId, workspaceId });

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-8">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Add a company</h1>
        <Link href={`/${workspaceId}`} className="rounded border px-3 py-1">
          Back
        </Link>
      </header>
      <CompanyForm mode="create" workspaceId={workspaceId} industries={industries} save={createCompany} unarchive={unarchiveCompany} />
    </main>
  );
}
