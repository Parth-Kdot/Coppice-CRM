import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";

// One PrismaClient per server process. Each client owns a connection pool, so
// creating one per request would quickly exhaust the database's connections.
//
// In development, Next.js re-runs modules on every hot reload. Storing the client
// on globalThis keeps a single instance across reloads instead of leaking pools.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env.");
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
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
