"use client";

import { useId, useState } from "react";
import { ActionForm } from "@/components/action-form";
import { ChipGroup } from "@/components/ledger/chips";
import type { ActionResult } from "@/lib/validation";
import "./company.css";
import "./pages.css";

// The invitation form: an email and a role. The role is a chip group of real radios, so it is sent
// with the form under the name "role", exactly as the old select was.
export function InviteForm({
  workspaceId,
  action,
}: {
  workspaceId: string;
  action: (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;
}) {
  const id = useId();
  const [role, setRole] = useState<"member" | "owner">("member");
  return (
    <ActionForm action={action} submitLabel="Invite" successMessage="Invitation created." className="lg-inviteform" primary>
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <div>
        <label className="lg-label" htmlFor={`${id}-email`}>
          Email
        </label>
        <input id={`${id}-email`} name="email" type="email" required placeholder="name@purdue.edu" autoComplete="off" className="lg-input" />
      </div>
      <ChipGroup
        legend="Role"
        name="role"
        value={role}
        onChange={setRole}
        options={[
          { value: "member", label: "Officer" },
          { value: "owner", label: "Owner" },
        ]}
      />
    </ActionForm>
  );
}
