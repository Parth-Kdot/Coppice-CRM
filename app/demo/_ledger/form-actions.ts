"use client";

import { useRouter } from "next/navigation";
import { useMemo, type Dispatch, type SetStateAction } from "react";
import { demoRoutes } from "@/demo/routes";
import { useDemoActions } from "@/demo/store";
import type { ActionResult, Role, Stage } from "@/demo/types";
import { createContext, useContext, useState, createElement, type ReactNode } from "react";

// The demo's stand-ins for the real app's server actions. Each one has the same shape as the
// action the real screens call, (previous result, form data) to a result, so the real client
// components run unchanged. They read the fields from the form, call the in-browser store and
// return what the store says. Nothing leaves the browser.

type Prev<T> = ActionResult<T> | null;
type Action<T = undefined> = (prev: Prev<T>, form: FormData) => Promise<ActionResult<T>>;

const text = (form: FormData, key: string) => String(form.get(key) ?? "");
const done: ActionResult = { ok: true, data: undefined };
const strip = <T,>(result: ActionResult<T>): ActionResult => (result.ok ? done : result);

// "A teammate wins the next Claim": a Demo menu switch that plays a teammate pressing Claim a
// moment before you do, so the refusal can be shown on cue.
type Race = { raceNext: boolean; setRaceNext: Dispatch<SetStateAction<boolean>> };
const RaceContext = createContext<Race>({ raceNext: false, setRaceNext: () => undefined });
export const useRace = (): Race => useContext(RaceContext);

export function DemoToolsProvider({ children }: { children: ReactNode }) {
  const [raceNext, setRaceNext] = useState(false);
  const value = useMemo(() => ({ raceNext, setRaceNext }), [raceNext]);
  return createElement(RaceContext.Provider, { value }, children);
}

export function useFormActions() {
  const actions = useDemoActions();
  const router = useRouter();
  const { raceNext, setRaceNext } = useRace();

  return useMemo(() => {
    const ws = (form: FormData) => text(form, "workspaceId");
    const company = (form: FormData) => text(form, "companyId");
    const fields = (form: FormData, prefix = "") => ({
      name: text(form, `${prefix}name`),
      industry: text(form, `${prefix}industry`),
      website: text(form, `${prefix}website`),
      notes: text(form, `${prefix}notes`),
    });
    const separate = (form: FormData) => text(form, "separateFrom").split(",").filter(Boolean);

    const claimCompany: Action = async (_prev, form) => {
      if (raceNext) {
        actions.simulateTeammateClaim(ws(form), company(form));
        setRaceNext(false);
      }
      return strip(actions.claimCompany(ws(form), company(form)));
    };
    const releaseClaim: Action = async (_prev, form) => strip(actions.releaseClaim(ws(form), company(form)));
    const forceRelease: Action = async (_prev, form) => strip(actions.forceRelease(ws(form), company(form)));
    const moveStage: Action = async (_prev, form) => strip(actions.moveStage(ws(form), company(form), text(form, "stage") as Stage));
    const logOutreach: Action = async (_prev, form) =>
      strip(
        actions.logOutreach(ws(form), company(form), {
          channel: text(form, "channel"),
          note: text(form, "note") || null,
          followUpOn: text(form, "followUpOn") || undefined,
          aiDraftId: text(form, "aiDraftId") || null,
        }),
      );

    const contact = (form: FormData) => ({ name: text(form, "name"), email: text(form, "email") || null, title: text(form, "title") || null });
    const addContact: Action = async (_prev, form) => strip(actions.addContact(ws(form), company(form), contact(form)));
    const updateContact: Action = async (_prev, form) => strip(actions.updateContact(ws(form), text(form, "contactId"), contact(form)));
    const removeContact: Action = async (_prev, form) => strip(actions.removeContact(ws(form), text(form, "contactId")));

    const createCompany: Action<ReturnType<typeof actions.createCompany> extends ActionResult<infer R> ? R : never> = async (_prev, form) => {
      const result = actions.createCompany(ws(form), fields(form), separate(form));
      if (result.ok && result.data.status === "saved") router.push(demoRoutes.company(ws(form), result.data.companyId));
      return result;
    };
    const updateCompany: Action<ReturnType<typeof actions.updateCompany> extends ActionResult<infer R> ? R : never> = async (_prev, form) =>
      actions.updateCompany(ws(form), company(form), { changes: fields(form), original: fields(form, "original.") }, separate(form));
    const archiveCompany: Action = async (_prev, form) => strip(actions.archiveCompany(ws(form), company(form)));
    const unarchiveCompany: Action = async (_prev, form) => {
      const result = actions.unarchiveCompany(ws(form), company(form));
      if (!result.ok) return result;
      if (text(form, "stay") !== "board") router.push(demoRoutes.company(ws(form), company(form)));
      return done;
    };
    const archiveAsDuplicate: Action = async (_prev, form) => {
      const result = actions.archiveDuplicate(ws(form), text(form, "keepId"), company(form));
      if (!result.ok) return result;
      router.push(demoRoutes.company(ws(form), text(form, "keepId")));
      return done;
    };
    const archiveDuplicate: Action = async (_prev, form) => strip(actions.archiveDuplicate(ws(form), text(form, "keepId"), text(form, "archiveId")));
    const keepSeparate: Action = async (_prev, form) => strip(actions.keepSeparate(ws(form), company(form), text(form, "otherId")));

    const draftEmail = async (_prev: unknown, form: FormData) => {
      const result = await actions.draftEmail(ws(form), company(form), {
        kind: text(form, "kind") === "FOLLOW_UP" ? "FOLLOW_UP" : "FIRST_TOUCH",
        contactId: text(form, "contactId") || null,
        note: text(form, "note") || null,
      });
      return result;
    };
    const checkDraft = async (_prev: unknown, form: FormData) => actions.checkDraft(ws(form), text(form, "draftId"), { subject: text(form, "subject"), body: text(form, "body") });

    const previewImport = async (_prev: unknown, form: FormData) => {
      const file = form.get("file");
      if (!(file instanceof File)) return { ok: false as const, error: "Choose a .csv file." };
      const checked = actions.checkImportFile({ name: file.name, size: file.size });
      if (!checked.ok) return checked;
      const mapping = text(form, "mapping");
      return actions.previewImport(ws(form), await file.text(), mapping ? JSON.parse(mapping) : null);
    };
    const runImport = async (_prev: unknown, form: FormData) => {
      const file = form.get("file");
      if (!(file instanceof File)) return { ok: false as const, error: "Choose a .csv file." };
      return actions.runImport(ws(form), await file.text(), JSON.parse(text(form, "mapping")), JSON.parse(text(form, "skip") || "[]"), JSON.parse(text(form, "seen") || "[]"));
    };

    const setFactVerified: Action = async (_prev, form) => strip(actions.setFactVerified(ws(form), text(form, "factId"), text(form, "verified") === "1"));
    const updateFact: Action = async (_prev, form) => strip(actions.updateFact(ws(form), text(form, "factId"), text(form, "text")));
    const addFact: Action = async (_prev, form) => strip(actions.addFact(ws(form), text(form, "text")));
    const deleteFact: Action = async (_prev, form) => strip(actions.deleteFact(ws(form), text(form, "factId")));
    const deleteFactSheet: Action = async (_prev, form) => strip(actions.deleteFactSheet(ws(form), text(form, "factSheetId")));
    const uploadFactSheet: Action = async (_prev, form) => {
      const file = form.get("file");
      const result = await actions.uploadFactSheet(ws(form), file instanceof File ? { name: file.name, size: file.size } : null);
      return strip(result);
    };

    const inviteMember: Action = async (_prev, form) => strip(actions.inviteMember(ws(form), text(form, "email"), text(form, "role") === "owner" ? "owner" : "member"));
    const cancelInvitation: Action = async (_prev, form) => strip(actions.cancelInvitation(ws(form), text(form, "invitationId")));
    const changeMemberRole: Action = async (_prev, form) => strip(actions.changeMemberRole(ws(form), text(form, "memberId"), text(form, "role") as Role));
    const removeMember: Action = async (_prev, form) => strip(actions.removeMember(ws(form), text(form, "memberId")));
    const leaveWorkspace: Action = async (_prev, form) => {
      const result = actions.leaveWorkspace(ws(form));
      if (!result.ok) return result;
      router.push(demoRoutes.workspaces());
      return done;
    };
    const updateClaimWindow: Action = async (_prev, form) => strip(actions.updateClaimWindow(ws(form), Number(text(form, "days"))));
    const updateAiSettings: Action = async (_prev, form) => strip(actions.updateAiSettings(ws(form), { enabled: form.get("enabled") !== null, limit: Number(text(form, "limit")) }));

    const createWorkspace: Action = async (_prev, form) => {
      const result = actions.createWorkspace(text(form, "name"));
      if (!result.ok) return result;
      router.push(demoRoutes.queue(result.data.workspaceId));
      return done;
    };
    const acceptInvitation: Action = async (_prev, form) => {
      const result = actions.acceptInvitation(text(form, "invitationId"));
      if (!result.ok) return result;
      router.push(demoRoutes.queue(result.data.workspaceId));
      return done;
    };

    return {
      claimCompany,
      releaseClaim,
      forceRelease,
      moveStage,
      logOutreach,
      addContact,
      updateContact,
      removeContact,
      createCompany,
      updateCompany,
      archiveCompany,
      unarchiveCompany,
      archiveAsDuplicate,
      archiveDuplicate,
      keepSeparate,
      draftEmail,
      checkDraft,
      previewImport,
      runImport,
      setFactVerified,
      updateFact,
      addFact,
      deleteFact,
      deleteFactSheet,
      uploadFactSheet,
      inviteMember,
      cancelInvitation,
      changeMemberRole,
      removeMember,
      leaveWorkspace,
      updateClaimWindow,
      updateAiSettings,
      createWorkspace,
      acceptInvitation,
    };
  }, [actions, router, raceNext, setRaceNext]);
}
