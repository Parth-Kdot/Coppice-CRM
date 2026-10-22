import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";

// Every /api/auth/* request (Google redirect, callback, session, sign-out) goes to Better Auth.
export const { GET, POST } = toNextJsHandler(auth);
