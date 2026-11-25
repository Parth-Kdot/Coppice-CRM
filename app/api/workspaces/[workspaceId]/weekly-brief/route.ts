import { AuthzError, requireMembership } from "@/lib/authz";
import { workspaceIdSchema } from "@/lib/validation";
import { ensureWeeklyBrief, readWeeklyBrief } from "@/lib/weekly-brief";

// The queue home's browser asks this once, after the page has rendered, to write the week's Monday
// brief (lib/weekly-brief). A route and not a server action: Next.js runs one tab's server actions
// one at a time, and this call can take up to 30 seconds, which would hold up Claim and Log
// outreach behind it. POST only, from this site only, for members only, and never cached.
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });
const refuse = (status: number) => new Response(null, { status, headers: NO_STORE });

// A request from another site is refused before anything is read: the browser's Sec-Fetch-Site
// (when it sends one) must say same-origin, and the Origin must be this site's own: the request's
// own origin, or the host the request was sent to (behind Vercel's proxy the two can differ).
function sameOrigin(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") return false;
  const origin = request.headers.get("origin");
  if (origin === null) return false;
  if (origin === new URL(request.url).origin) return true;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  const sentTo = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  return sentTo !== null && host === sentTo;
}

export async function POST(request: Request, ctx: RouteContext<"/api/workspaces/[workspaceId]/weekly-brief">) {
  if (!sameOrigin(request)) return refuse(403);
  const parsed = workspaceIdSchema.safeParse((await ctx.params).workspaceId);
  if (!parsed.success) return refuse(400);

  let member;
  try {
    member = await requireMembership(parsed.data);
  } catch (error) {
    // The same answer whether the workspace doesn't exist or you aren't in it, so ids can't be probed.
    if (error instanceof AuthzError) return refuse(404);
    throw error;
  }

  const outcome = await ensureWeeklyBrief(member);
  return json({ outcome, brief: await readWeeklyBrief(member) });
}

export function GET() {
  return new Response(null, { status: 405, headers: { ...NO_STORE, Allow: "POST" } });
}
