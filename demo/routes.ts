import type { Stage } from "./types";
import { STAGES } from "./types";

// The one place the prototype URLs are defined. Every design branch builds its links from these
// helpers, so all eight prototypes use identical URLs. The landing page at "/" belongs to each
// design branch (it replaces app/page.tsx); everything else lives under /demo.

export const DEMO_ROUTE_PATTERNS = {
  landing: "/",
  signIn: "/demo/signin",
  workspaces: "/demo/workspaces",
  queue: "/demo/w/[ws]",
  board: "/demo/w/[ws]/board",
  companies: "/demo/w/[ws]/companies",
  company: "/demo/w/[ws]/companies/[companyId]",
  newCompany: "/demo/w/[ws]/companies/new",
  import: "/demo/w/[ws]/import",
  facts: "/demo/w/[ws]/facts",
  settings: "/demo/w/[ws]/settings",
} as const;

export type DemoScreen = keyof typeof DEMO_ROUTE_PATTERNS;

// ----- Filters that live in the URL, like the real app (a view can be bookmarked and Back works) -----

// The queue's view tabs: everything due, only what I hold, due within the week, and fresh leads.
export const QUEUE_VIEWS = ["all", "mine", "week", "never"] as const;
export type QueueView = (typeof QUEUE_VIEWS)[number];
// How the queue is ordered: most overdue first, closest to today, by name, or by stage.
export const QUEUE_SORTS = ["overdue", "due", "company", "stage"] as const;
export type QueueSort = (typeof QUEUE_SORTS)[number];

export type QueueFilters = {
  // Only companies I hold with a live claim. The same thing as view "mine": ?mine=1 still works.
  mine: boolean;
  // Which tab is open.
  view: QueueView;
  sort: QueueSort;
  // Only what is already past its follow-up date.
  overdue: boolean;
  // The "Never contacted" section is open.
  never: boolean;
  // One section showing everything instead of the first 50.
  all: "due" | "never" | null;
};

export type BoardFilters = {
  // Search by company name.
  q: string;
  industry: string;
  // One station picked in the strip above the columns, or null for the whole board.
  stage: Stage | null;
  // Committed and Declined start collapsed; these are the ones opened.
  show: Stage[];
  // One column showing every card instead of the first 50.
  all: Stage | null;
  // The Archived section is open.
  archived: boolean;
  // The Possible duplicates section is open.
  dupes: boolean;
};

// The Companies screen: the whole workspace as one ruled table.
export const COMPANY_SORTS = ["recent", "followup", "name", "stage"] as const;
export type CompanySort = (typeof COMPANY_SORTS)[number];

export type CompaniesFilters = {
  // Search by name, industry, website, contact name or email.
  q: string;
  // One stage, or null for all of them.
  stage: Stage | null;
  sort: CompanySort;
};

export const DEFAULT_COMPANIES_FILTERS: CompaniesFilters = { q: "", stage: null, sort: "recent" };
export const DEFAULT_QUEUE_FILTERS: QueueFilters = { mine: false, view: "all", sort: "overdue", overdue: false, never: false, all: null };
export const DEFAULT_BOARD_FILTERS: BoardFilters = { q: "", industry: "", stage: null, show: [], all: null, archived: false, dupes: false };

// Anything that reads like search params: the URLSearchParams from useSearchParams(), or the plain
// object a page receives as searchParams.
export type SearchParamsInput = URLSearchParams | Record<string, string | string[] | undefined> | null | undefined;

function firstParam(params: SearchParamsInput, key: string): string | null {
  if (!params) return null;
  if (params instanceof URLSearchParams) return params.get(key);
  const value = params[key];
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

const isStage = (value: string): value is Stage => (STAGES as readonly string[]).includes(value);

// Malformed values are dropped instead of failing, the same way the real app treats a hand-edited URL.
export function parseQueueFilters(params: SearchParamsInput): QueueFilters {
  const all = firstParam(params, "all");
  const viewParam = firstParam(params, "view");
  const sortParam = firstParam(params, "sort");
  const view: QueueView = (QUEUE_VIEWS as readonly string[]).includes(viewParam ?? "") ? (viewParam as QueueView) : firstParam(params, "mine") === "1" ? "mine" : "all";
  return {
    mine: view === "mine",
    view,
    sort: (QUEUE_SORTS as readonly string[]).includes(sortParam ?? "") ? (sortParam as QueueSort) : DEFAULT_QUEUE_FILTERS.sort,
    overdue: firstParam(params, "overdue") === "1",
    never: firstParam(params, "never") === "1",
    all: all === "due" || all === "never" ? all : null,
  };
}

export function parseBoardFilters(params: SearchParamsInput): BoardFilters {
  const show = (firstParam(params, "show") ?? "").split(",").filter(isStage);
  const all = firstParam(params, "all");
  const stage = firstParam(params, "stage");
  return {
    q: (firstParam(params, "q") ?? "").trim().slice(0, 100),
    industry: (firstParam(params, "industry") ?? "").trim().slice(0, 80),
    stage: stage && isStage(stage) ? stage : null,
    show,
    all: all && isStage(all) ? all : null,
    archived: firstParam(params, "archived") === "1",
    dupes: firstParam(params, "dupes") === "1",
  };
}

export function parseCompaniesFilters(params: SearchParamsInput): CompaniesFilters {
  const stage = firstParam(params, "stage");
  const sort = firstParam(params, "sort");
  return {
    q: (firstParam(params, "q") ?? "").trim().slice(0, 100),
    stage: stage && isStage(stage) ? stage : null,
    sort: sort && (COMPANY_SORTS as readonly string[]).includes(sort) ? (sort as CompanySort) : DEFAULT_COMPANIES_FILTERS.sort,
  };
}

// The query string for a Companies view, "" when every filter is at its default.
export function companiesQuery(filters: Partial<CompaniesFilters> = {}): string {
  const f = { ...DEFAULT_COMPANIES_FILTERS, ...filters };
  const params = new URLSearchParams();
  if (f.q) params.set("q", f.q);
  if (f.stage) params.set("stage", f.stage);
  if (f.sort !== DEFAULT_COMPANIES_FILTERS.sort) params.set("sort", f.sort);
  const query = params.toString();
  return query ? `?${query}` : "";
}

// The query string for a queue view, "" when every filter is at its default.
export function queueQuery(filters: Partial<QueueFilters> = {}): string {
  const f = { ...DEFAULT_QUEUE_FILTERS, ...filters };
  const view: QueueView = f.view === "all" && f.mine ? "mine" : f.view;
  const params = new URLSearchParams();
  if (view !== "all") params.set("view", view);
  if (f.sort !== DEFAULT_QUEUE_FILTERS.sort) params.set("sort", f.sort);
  if (f.overdue) params.set("overdue", "1");
  if (f.never) params.set("never", "1");
  if (f.all) params.set("all", f.all);
  const query = params.toString();
  return query ? `?${query}` : "";
}

// The query string for a board view, "" when every filter is at its default.
export function boardQuery(filters: Partial<BoardFilters> = {}): string {
  const f = { ...DEFAULT_BOARD_FILTERS, ...filters };
  const params = new URLSearchParams();
  if (f.q) params.set("q", f.q);
  if (f.industry) params.set("industry", f.industry);
  if (f.stage) params.set("stage", f.stage);
  if (f.show.length > 0) params.set("show", f.show.join(","));
  if (f.all) params.set("all", f.all);
  if (f.archived) params.set("archived", "1");
  if (f.dupes) params.set("dupes", "1");
  const query = params.toString();
  return query ? `?${query}` : "";
}

// ----- URL helpers -----

// Anchors on the company page. The queue's "Log outreach" button jumps to the log form.
export const COMPANY_ANCHORS = { logOutreach: "log-outreach", draft: "draft-email" } as const;

const seg = encodeURIComponent;
const workspacePath = (ws: string) => `/demo/w/${seg(ws)}`;

export const demoRoutes = {
  landing: (): string => "/",
  signIn: (): string => "/demo/signin",
  workspaces: (): string => "/demo/workspaces",
  queue: (ws: string, filters?: Partial<QueueFilters>): string => `${workspacePath(ws)}${queueQuery(filters)}`,
  board: (ws: string, filters?: Partial<BoardFilters>): string => `${workspacePath(ws)}/board${boardQuery(filters)}`,
  companies: (ws: string, filters?: Partial<CompaniesFilters>): string => `${workspacePath(ws)}/companies${companiesQuery(filters)}`,
  company: (ws: string, companyId: string, options?: { anchor?: keyof typeof COMPANY_ANCHORS }): string =>
    `${workspacePath(ws)}/companies/${seg(companyId)}${options?.anchor ? `#${COMPANY_ANCHORS[options.anchor]}` : ""}`,
  newCompany: (ws: string): string => `${workspacePath(ws)}/companies/new`,
  import: (ws: string): string => `${workspacePath(ws)}/import`,
  facts: (ws: string): string => `${workspacePath(ws)}/facts`,
  settings: (ws: string): string => `${workspacePath(ws)}/settings`,
} as const;

// ----- Navigation helpers -----

export type WorkspaceNavKey = "queue" | "board" | "companies" | "newCompany" | "import" | "facts" | "settings";

// The destinations the real app links to from a workspace, in the order its header lists them.
// The real header has no link to the fact sheet (Settings links to it); a design may promote it.
export const WORKSPACE_NAV: readonly { key: WorkspaceNavKey; label: string; href: (ws: string) => string }[] = [
  { key: "queue", label: "Queue", href: (ws) => demoRoutes.queue(ws) },
  { key: "board", label: "Board", href: (ws) => demoRoutes.board(ws) },
  { key: "companies", label: "Companies", href: (ws) => demoRoutes.companies(ws) },
  { key: "newCompany", label: "Add company", href: (ws) => demoRoutes.newCompany(ws) },
  { key: "import", label: "Import", href: (ws) => demoRoutes.import(ws) },
  { key: "facts", label: "Fact sheet", href: (ws) => demoRoutes.facts(ws) },
  { key: "settings", label: "Settings", href: (ws) => demoRoutes.settings(ws) },
];

export type MatchedRoute = { screen: DemoScreen; ws: string | null; companyId: string | null };

// Which screen a pathname belongs to, for highlighting the current item in a navigation.
export function matchDemoRoute(pathname: string): MatchedRoute | null {
  const parts = pathname.split("?")[0].split("#")[0].split("/").filter(Boolean).map(decodeURIComponent);
  if (parts.length === 0) return { screen: "landing", ws: null, companyId: null };
  if (parts[0] !== "demo") return null;
  if (parts.length === 2 && parts[1] === "signin") return { screen: "signIn", ws: null, companyId: null };
  if (parts.length === 2 && parts[1] === "workspaces") return { screen: "workspaces", ws: null, companyId: null };
  if (parts[1] !== "w" || parts.length < 3) return null;
  const ws = parts[2];
  const rest = parts.slice(3);
  if (rest.length === 0) return { screen: "queue", ws, companyId: null };
  if (rest.length === 1 && rest[0] === "board") return { screen: "board", ws, companyId: null };
  if (rest.length === 1 && rest[0] === "companies") return { screen: "companies", ws, companyId: null };
  if (rest.length === 1 && rest[0] === "import") return { screen: "import", ws, companyId: null };
  if (rest.length === 1 && rest[0] === "facts") return { screen: "facts", ws, companyId: null };
  if (rest.length === 1 && rest[0] === "settings") return { screen: "settings", ws, companyId: null };
  if (rest.length === 2 && rest[0] === "companies") {
    return rest[1] === "new" ? { screen: "newCompany", ws, companyId: null } : { screen: "company", ws, companyId: rest[1] };
  }
  return null;
}
