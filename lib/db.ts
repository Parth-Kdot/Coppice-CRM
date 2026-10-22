import { PrismaPg } from "@prisma/adapter-pg";
import type { PoolConfig } from "pg";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";

// One PrismaClient per server process. Each client owns a connection pool, so
// creating one per request would quickly exhaust the database's connections.
//
// In development, Next.js re-runs modules on every hot reload. Storing the client
// on globalThis keeps a single instance across reloads instead of leaking pools.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Connection settings for the app's pool. Locally that's just DATABASE_URL. In production,
// DATABASE_CA_CERT holds Supabase's public root certificate: the connection is encrypted and the
// app checks it is really talking to Supabase (not someone in between). We pass the certificate
// here instead of using sslmode in the URL, because Node doesn't trust Supabase's own CA by default.
export function connectionConfig(env: Record<string, string | undefined> = process.env): PoolConfig {
  const connectionString = env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env.");
  }
  const ca = env.DATABASE_CA_CERT?.replace(/\\n/g, "\n").trim();
  if (!ca) return { connectionString };
  if (!ca.startsWith("-----BEGIN CERTIFICATE-----")) {
    throw new Error("DATABASE_CA_CERT must be the PEM certificate text, starting with -----BEGIN CERTIFICATE-----.");
  }
  // An sslmode in the URL would override the settings below, silently dropping the CA check.
  if (/[?&]sslmode=/i.test(connectionString)) {
    throw new Error("Remove sslmode from DATABASE_URL: with DATABASE_CA_CERT set, the app configures verified SSL itself.");
  }
  return { connectionString, ssl: { ca, rejectUnauthorized: true } };
}

function createPrismaClient(): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg(connectionConfig()) });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

// Who is asking, and about which workspace. A Membership from requireMembership/requireOwner
// fits here directly, which is the intended flow: check membership first, then query.
export type Tenant = { userId: string; workspaceId: string };

// Every read and write of workspace data (companies, contacts, templates, outreach) goes
// through this. It opens a transaction and tells Postgres who the user and workspace are; the
// row-level security policies (prisma/migrations/*_tenant_rls) then only let that transaction
// see and write rows of that workspace, and only if the user is a member. Outside withTenant,
// those tables look empty.
//
// set_config(..., true) lasts only until the transaction ends. That matters with Supabase's
// pooler, which hands the same connection to other requests afterwards. Never use plain SET.
// Keep slow work (AI calls, network requests) outside: the transaction holds a connection.
export function withTenant<T>(tenant: Tenant, run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.user_id', ${tenant.userId}, true), set_config('app.workspace_id', ${tenant.workspaceId}, true)`;
      return run(tx);
    },
    // Room for the pooler and network latency to Supabase.
    { maxWait: 10_000, timeout: 15_000 },
  );
}
