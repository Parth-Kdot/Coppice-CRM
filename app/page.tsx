import { redirect } from "next/navigation";

// /workspaces sends signed-out visitors on to /signin.
export default function Home() {
  redirect("/workspaces");
}
