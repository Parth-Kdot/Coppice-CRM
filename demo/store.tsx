"use client";

import { useSearchParams } from "next/navigation";
import { createContext, useContext, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { DEFAULT_BOARD_FILTERS, DEFAULT_QUEUE_FILTERS, parseBoardFilters, parseQueueFilters, type BoardFilters, type QueueFilters } from "./routes";
import {
  myMembership,
  selectActivity,
  selectBoard,
  selectCompany,
  selectFactSheet,
  selectIndustries,
  selectMe,
  selectQueue,
  selectReplyChoice,
  selectSearch,
  selectSettings,
  selectTemplateStats,
  selectWorkspaceList,
  selectWorkspaceStats,
  workspaceById,
} from "./selectors";
import { createDemoStore, type DemoActions, type DemoStore, type StoreOptions } from "./store-core";
import type { DemoState, Stage, Workspace } from "./types";

// The shared mock state for every prototype, as a React provider plus hooks. app/demo/layout.tsx
// wraps the whole /demo tree in <DemoProvider>, so state survives moving between screens and is lost
// on a full page reload (resetDemo() does the same on purpose). There is no database, no network and
// no real clock: the state starts identical on the server and in the browser, and only changes in
// response to actions.
//
//   const { claimCompany } = useDemoActions();
//   const result = claimCompany(ws, companyId);          // { ok: true, data } or { ok: false, error }
//   const queue = useQueue(ws, filters);                 // re-renders when anything it shows changes
//
// Actions are plain functions, not form actions: call them from onClick or onSubmit, then show
// result.error where the person clicked.

const StoreContext = createContext<DemoStore | null>(null);

function useStore(): DemoStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error("Demo hooks must be used inside <DemoProvider> (app/demo/layout.tsx provides it).");
  return store;
}

export function DemoProvider({ children, instant = false }: { children: ReactNode } & StoreOptions) {
  // One store per provider, created once. `instant` is read on creation only.
  const [store] = useState(() => createDemoStore({ instant }));
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

// The whole state. Prefer the selector hooks below; use this for the tools panel and for experiments.
export function useDemoState(): DemoState {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

// Every action. The object never changes, so it is safe in dependency lists and does not re-render.
export function useDemoActions(): DemoActions {
  return useStore().actions;
}

export function useDemo(): { state: DemoState; actions: DemoActions } {
  return { state: useDemoState(), actions: useDemoActions() };
}

// ----- Selector hooks. Each recomputes only when the state or its arguments change. -----

export function useWorkspaceList() {
  const state = useDemoState();
  return useMemo(() => selectWorkspaceList(state), [state]);
}

export function useWorkspace(ws: string): Workspace | undefined {
  const state = useDemoState();
  return workspaceById(state, ws);
}

// The signed-in person and their role in this workspace. role is null when they are not a member,
// which the real app shows as a 404 page.
export function useMe(ws: string) {
  const state = useDemoState();
  return useMemo(() => selectMe(state, ws), [state, ws]);
}

export function useWorkspaceStats(ws: string) {
  const state = useDemoState();
  return useMemo(() => selectWorkspaceStats(state, ws), [state, ws]);
}

export function useActivity(ws: string, limit = 20) {
  const state = useDemoState();
  return useMemo(() => selectActivity(state, ws, limit), [state, ws, limit]);
}

// Filters can be an object built on each render, so the dependency is its content.
const keyOf = (value: unknown) => JSON.stringify(value ?? null);

export function useQueue(ws: string, filters: QueueFilters = DEFAULT_QUEUE_FILTERS) {
  const state = useDemoState();
  const key = keyOf(filters);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for `filters`
  return useMemo(() => selectQueue(state, ws, filters), [state, ws, key]);
}

export function useBoard(ws: string, filters: BoardFilters = DEFAULT_BOARD_FILTERS) {
  const state = useDemoState();
  const key = keyOf(filters);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for `filters`
  return useMemo(() => selectBoard(state, ws, filters), [state, ws, key]);
}

// The queue filters as they are in the page's URL (?mine=1&never=1&all=due), parsed the way the
// real app parses them. Build links with demoRoutes.queue(ws, { mine: true }).
export function useQueueFilters(): QueueFilters {
  const params = useSearchParams();
  const text = params.toString();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `text` stands for `params`
  return useMemo(() => parseQueueFilters(params), [text]);
}

// The board filters as they are in the page's URL (?q=acme&industry=Tech&show=COMMITTED&all=CONTACTED).
export function useBoardFilters(): BoardFilters {
  const params = useSearchParams();
  const text = params.toString();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `text` stands for `params`
  return useMemo(() => parseBoardFilters(params), [text]);
}

// One company in full: its contacts, outreach log, stage history, claim, and which buttons apply.
// Null when it does not exist in this workspace (the real app shows a 404 page).
export function useCompany(ws: string, companyId: string) {
  const state = useDemoState();
  return useMemo(() => selectCompany(state, ws, companyId), [state, ws, companyId]);
}

export function useCompanySearch(ws: string, query: string, options?: { includeArchived?: boolean; limit?: number }) {
  const state = useDemoState();
  const includeArchived = options?.includeArchived;
  const limit = options?.limit;
  return useMemo(() => selectSearch(state, ws, query, { includeArchived, limit }), [state, ws, query, includeArchived, limit]);
}

export function useIndustries(ws: string) {
  const state = useDemoState();
  return useMemo(() => selectIndustries(state, ws), [state, ws]);
}

// Whether moving a company to this stage should first ask which outreach got the reply.
export function useReplyChoice(ws: string, companyId: string, toStage: Stage) {
  const state = useDemoState();
  return useMemo(() => selectReplyChoice(state, ws, companyId, toStage), [state, ws, companyId, toStage]);
}

export function useTemplateStats(ws: string) {
  const state = useDemoState();
  return useMemo(() => selectTemplateStats(state, ws), [state, ws]);
}

export function useFactSheet(ws: string) {
  const state = useDemoState();
  return useMemo(() => selectFactSheet(state, ws), [state, ws]);
}

// Null when the person is not a member of the workspace.
export function useSettings(ws: string) {
  const state = useDemoState();
  return useMemo(() => selectSettings(state, ws), [state, ws]);
}

// True while the person is a member of the workspace. Use it to show the 404 the real app shows.
export function useIsMember(ws: string): boolean {
  const state = useDemoState();
  return myMembership(state, ws) !== undefined;
}
