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

// How many connections one server instance may hold at once. pg's own default is 10; on Vercel
// every instance has its own pool, and Supabase's transaction pooler shares a fixed number of
// connections between all of them, so each instance keeps to 5 unless DATABASE_POOL_MAX says
// otherwise (a whole number from 1 to 50). A request that finds the pool full waits for a free
// connection (withTenant's maxWait) rather than failing at once.
export const DEFAULT_POOL_MAX = 5;
export function poolMax(env: Record<string, string | undefined> = process.env): number {
  const raw = env.DATABASE_POOL_MAX?.trim();
  if (!raw) return DEFAULT_POOL_MAX;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 50) {
    throw new Error("DATABASE_POOL_MAX must be a whole number from 1 to 50.");
  }
  return n;
}

function createPrismaClient(): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ ...connectionConfig(), max: poolMax() }) });
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
//
// `isolationLevel: "Serializable"` is for a count followed by an insert that must not race with
// the same thing in parallel (a limit): Postgres then fails all but one of the overlapping
// transactions with a serialization error (Prisma's P2034, see isSerializationFailure), and the
// caller retries or refuses.
export function withTenant<T>(
  tenant: Tenant,
  run: (tx: Prisma.TransactionClient) => Promise<T>,
  options: { isolationLevel?: Prisma.TransactionIsolationLevel } = {},
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.user_id', ${tenant.userId}, true), set_config('app.workspace_id', ${tenant.workspaceId}, true)`;
      return run(tx);
    },
    // Room for the pooler and network latency to Supabase.
    { maxWait: 10_000, timeout: 15_000, ...options },
  );
}

// Whether a withTenant transaction failed only because a parallel one won (a serialization
// failure or deadlock), so running it again may succeed. Prisma reports it as P2034, or, from the
// pg driver adapter, as a DriverAdapterError whose cause has kind "TransactionWriteConflict" and
// Postgres's code 40001 (40P01 for a deadlock).
export function isSerializationFailure(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && typeof current === "object" && current !== null; depth++) {
    const e = current as { code?: unknown; kind?: unknown; originalCode?: unknown; cause?: unknown };
    if (e.code === "P2034" || e.kind === "TransactionWriteConflict" || e.originalCode === "40001" || e.originalCode === "40P01") return true;
    current = e.cause;
  }
  return false;
}

// A transaction-scoped advisory lock on `key`, taken as the transaction's first statement so
// two runs of the same work (two imports into one workspace) go one after the other: the second
// waits until the first commits or rolls back, then sees what it wrote. Released with the
// transaction, so nothing can leak it across the pooler.
export async function advisoryXactLock(tx: Prisma.TransactionClient, key: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
}
