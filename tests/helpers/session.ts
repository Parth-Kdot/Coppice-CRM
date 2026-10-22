import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { testUtils } from "better-auth/plugins";
import { prisma } from "@/lib/db";

// A second Better Auth instance used only by tests. Its testUtils plugin can create a real,
// signed session for any user without going through Google. It shares the database and
// BETTER_AUTH_SECRET with the app's instance, so the app accepts these sessions. Better Auth
// recommends keeping this plugin out of the production config, which is why it lives here.
const testAuth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  plugins: [testUtils()],
});

// Request headers carrying a signed-in session cookie for this user.
export async function signedInHeaders(userId: string): Promise<Headers> {
  const ctx = await testAuth.$context;
  const { headers } = await ctx.test.login({ userId });
  return headers;
}
