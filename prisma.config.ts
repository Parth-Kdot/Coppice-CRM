// Prisma CLI configuration (migrate, generate, studio). The running app does not read this file.
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Migrations use the direct (unpooled) connection; poolers can break schema changes.
    url: env("DIRECT_URL"),
  },
});
