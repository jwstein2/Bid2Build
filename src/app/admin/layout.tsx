import type { Metadata } from "next";
import { Logo } from "@/components/layout/logo";
import { AdminShell } from "@/components/admin/admin-shell";
import { requireAdmin } from "@/lib/admin/server";

export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Non-admins get a 404 before anything renders (requireAdmin), on every admin route.
  const { user } = await requireAdmin();
  return <AdminShell email={user.email ?? ""} logo={<Logo tone="dark" href="/admin" />}>{children}</AdminShell>;
}
