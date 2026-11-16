import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import { WarningIcon } from "@/components/ledger/icons";
import { SHOOTS_THREE, Stool } from "@/components/brand/stool";
import { ConsentButtons } from "@/components/oauth-consent";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { WORKSPACES_SHOWN } from "@/lib/limits";
import { SCOPE_LABELS } from "@/lib/mcp/config";
import { safeClientName } from "@/lib/mcp/oauth-limits";
import "@/components/ledger/ledger.css";
import "@/components/ledger/auth.css";

export const metadata: Metadata = { title: "Allow an assistant?" };

// The consent page (lib/auth.ts, consentPage): Better Auth sends a signed-in person here the first
// time an AI assistant asks for their account. It names the app, where it sends them back, and
// each thing it asks for; the person allows or denies. Nothing is shown from a request whose
// signature doesn't check out or has expired, so a hand-made link can't dress up a fake app.
// The app's name is whatever it registered with, so it is shown without control or formatting
// characters and inside <bdi> (a right-to-left override in it can't reorder Coppice's own words),
// and where it sends the person back is shown first, under the heading: that host is the one thing
// an app can't fake.

type Search = Record<string, string | string[] | undefined>;

// The query exactly as signed, rebuilt from Next.js's parsed form (repeated keys stay repeated).
function queryString(search: Search): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, v);
  }
  return params.toString();
}

// The host, such as "example.com", or "an app on this computer" for one that runs on the person's own machine.
function returnsTo(redirectUri: string | null): string {
  if (!redirectUri) return "an unknown address";
  try {
    const url = new URL(redirectUri);
    if (["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) return `an app on this computer (${url.host})`;
    return url.protocol === "https:" || url.protocol === "http:" ? url.host : `the app "${url.protocol.replace(/:$/, "")}"`;
  } catch {
    return "an unknown address";
  }
}

function Expired() {
  return (
    <>
      <h1 className="lg-auth-title">This link has expired</h1>
      <p className="lg-auth-sub">Go back to your assistant and connect to Coppice again. Requests to connect last ten minutes.</p>
    </>
  );
}

export default async function ConsentPage({ searchParams }: PageProps<"/oauth/consent">) {
  const search = await searchParams;
  const query = queryString(search);
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) redirect(`/oauth/signin?${query}`);

  const params = new URLSearchParams(query);
  const clientId = params.get("client_id");
  const { secret } = await auth.$context;
  const valid = clientId !== null && (await verifyOAuthQueryParams(query, secret));
  const client = valid
    ? await auth.api.getOAuthClientPublic({ query: { client_id: clientId }, headers: requestHeaders }).catch(() => null)
    : null;

  const scopes = (params.get("scope") ?? "").split(" ").filter(Boolean);
  const name = safeClientName(client?.client_name) || "An unnamed app";
  const backTo = returnsTo(params.get("redirect_uri"));
  const workspaces = client
    ? await prisma.membership.findMany({
        where: { userId: session.user.id, workspace: { mcpEnabled: true } },
        select: { workspace: { select: { id: true, name: true } } },
        orderBy: { createdAt: "asc" },
        take: WORKSPACES_SHOWN,
      })
    : [];

  return (
    <div className="lg-auth">
      <a className="lg-skip" href="#main">
        Skip to the page
      </a>
      <div className="lg-auth-art" aria-hidden="true">
        <Stool shoots={SHOOTS_THREE} className="lg-auth-stool" />
        <p className="lg-auth-line">New board, same roots.</p>
      </div>
      <main id="main" tabIndex={-1} className="lg-auth-main lg-page-enter">
        {!client ? (
          <Expired />
        ) : (
          <>
            <p className="lg-sc">Connect an assistant</p>
            <h1 className="lg-auth-title lg-consent-title">
              Allow <bdi>{name}</bdi> to use your Coppice account?
            </h1>
            <p className="lg-auth-sub">
              It sends you back to <strong className="lg-wrap-any">{backTo}</strong>
            </p>
            <dl className="lg-consent-facts">
              <div>
                <dt>Signed in as</dt>
                <dd>
                  {session.user.name} ({session.user.email})
                </dd>
              </div>
            </dl>
            <p className="lg-error lg-consent-warn">
              <WarningIcon size={16} />
              <span>
                Coppice doesn&apos;t check who made this app: any app can call itself &ldquo;<bdi>{name}</bdi>&rdquo;. Allow it only if you just
                started this from your own assistant.
              </span>
            </p>
            <h2 className="lg-h3">It asks to</h2>
            <ul className="lg-consent-scopes">
              {scopes.map((scope) => (
                <li key={scope}>
                  {SCOPE_LABELS[scope] ?? scope}
                  <span className="lg-muted"> ({scope})</span>
                </li>
              ))}
            </ul>
            <p className="lg-consent-note">
              {workspaces.length === 0
                ? "None of your workspaces allow assistants yet, so it can't see any workspace data until an owner turns assistants on in Settings."
                : `It can reach ${workspaces.map((w) => w.workspace.name).join(", ")}: the workspaces where an owner turned assistants on.`}{" "}
              What it reads, including contact names and emails, company notes and outreach, goes to the AI company behind the assistant.
              Changes it makes are marked &quot;via assistant&quot; in the history.
            </p>
            <ConsentButtons clientName={name} />
          </>
        )}
        <p className="lg-auth-back">
          <Link href="/workspaces" className="lg-link">
            Go to your workspaces instead
          </Link>
        </p>
      </main>
    </div>
  );
}
