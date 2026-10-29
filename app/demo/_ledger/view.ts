import { day } from "@/lib/dates";
import type { ClaimView } from "@/components/ledger/claim-chip";
import type { ClaimView as DemoClaim } from "@/demo/selectors";

// Small converters between the in-browser store and what the real screens' components expect.
export const toDate = (iso: string): Date => new Date(iso);

export const claimData = (claim: DemoClaim): ClaimView => ({
  state: claim.state,
  holderName: claim.holderName,
  until: claim.expiresAt ? day(new Date(claim.expiresAt)) : null,
});
