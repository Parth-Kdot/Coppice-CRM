// Prisma CLI configuration (migrate, generate, studio). The running app does not read this file.
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    // `npx prisma db seed`; same as `npm run db:seed`. Refuses to run on a non-local database.
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Migrations use the owner's connection (Supabase: the session pooler, port 5432). Only
    // migrate needs it. `prisma generate` runs on every install, including Vercel's build, where
    // DIRECT_URL is deliberately absent so the owner password never lives on Vercel.
    url: process.env.DIRECT_URL ?? "",
  },
});
