"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { hasTwoStep, requireStaffCap } from "@/lib/staff/server";

/** Choose which explicitly authorized book holds Built2Bid LLC's business bank feeds, and exclude personal accounts. Owner + two-step. */
export async function designateBook(fd: FormData) {
  const { user, db } = await requireStaffCap("banking.manage");
  if (!(await hasTwoStep())) redirect("/admin/banking?err=two_step");
  const book = String(fd.get("book") ?? "");
  const excluded = fd.getAll("excluded").map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  const { error } = await db.rpc("admin_banking_designate", { p_caller: user.id, p_book: /^[0-9a-f-]{36}$/i.test(book) ? book : null, p_excluded: excluded });
  revalidatePath("/admin/banking");
  redirect(error ? `/admin/banking?err=${encodeURIComponent((error.message ?? "").includes("book_not_owned") ? "book_not_owned" : "invalid")}` : "/admin/banking?ok=1");
}
