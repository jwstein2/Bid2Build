import { redirect } from "next/navigation";

/** Replaced by Product usage in the V2 command center; kept so old links still work. */
export default function ActivityMoved() {
  redirect("/admin/usage");
}
