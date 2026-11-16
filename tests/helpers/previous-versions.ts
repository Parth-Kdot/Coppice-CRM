import { Client } from "pg";
import { testDatabaseUrls } from "../test-db";

// Previous versions as the database owner sees them (all workspaces, row-level security bypassed),
// and a way to make one older, which the app itself can never do (app_user has no UPDATE on the table).
async function asOwner<T>(run: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client({ connectionString: testDatabaseUrls().ownerUrl });
  await db.connect();
  try {
    return await run(db);
  } finally {
    await db.end();
  }
}

export const ageVersion = (id: string, interval: string) =>
  asOwner((db) => db.query('UPDATE "PreviousVersion" SET "replacedAt" = now() - $1::interval WHERE id = $2', [interval, id]));

export type VersionRow = { id: string; workspaceId: string; companyId: string; contactId: string | null; field: string; value: string | null; via: string; replacedById: string; replacedAt: Date };

export const allVersions = () => asOwner(async (db) => (await db.query('SELECT * FROM "PreviousVersion" ORDER BY "replacedAt", id')).rows as VersionRow[]);

export const insertVersionAsOwner = (row: { id: string; workspaceId: string; companyId: string; contactId: string | null; field: string; value: string | null; replacedById: string }) =>
  asOwner((db) =>
    db.query('INSERT INTO "PreviousVersion" (id, "workspaceId", "companyId", "contactId", "subjectId", field, value, "replacedById") VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [
      row.id, row.workspaceId, row.companyId, row.contactId, row.contactId ?? row.companyId, row.field, row.value, row.replacedById,
    ]),
  );

// n expired TITLE slots in one statement: n contacts on one company, and a slot for each, aged two
// hours. One owner statement, so a batch test does not open a thousand connections.
export const insertExpiredVersions = (n: number, workspaceId: string, companyId: string, replacedById: string) =>
  asOwner(async (db) => {
    await db.query(
      `INSERT INTO "Contact" (id, "workspaceId", "companyId", name) SELECT 'bulk-ct-' || g, $1, $2, 'Bulk ' || g FROM generate_series(1, $3::int) g`,
      [workspaceId, companyId, n],
    );
    await db.query(
      `INSERT INTO "PreviousVersion" (id, "workspaceId", "companyId", "contactId", "subjectId", field, value, "replacedById")
       SELECT 'bulk-pv-' || g, $1, $2, 'bulk-ct-' || g, 'bulk-ct-' || g, 'TITLE', 'old', $4 FROM generate_series(1, $3::int) g`,
      [workspaceId, companyId, n, replacedById],
    );
    await db.query(`UPDATE "PreviousVersion" SET "replacedAt" = now() - interval '2 hours' WHERE id LIKE 'bulk-pv-%'`);
  });
