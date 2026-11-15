import { redirect } from "next/navigation";

/** Location diagnostics now live under Operations; kept so old links still work. */
export default function DataQualityMoved() {
  redirect("/admin/operations#data");
}
