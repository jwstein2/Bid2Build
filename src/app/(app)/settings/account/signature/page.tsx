import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { getUser } from "@/lib/supabase/server";
import { isContractorSigningEnabled } from "@/lib/esign/contractor/config";
import { MySignature } from "./my-signature";

export const metadata: Metadata = { title: "My signature", robots: { index: false } };

/** Account Settings → My Signature. Everything loads client-side from /api/signing/credential. */
export default async function MySignaturePage() {
  if (!isContractorSigningEnabled()) notFound();
  const user = await getUser();
  if (!user) redirect("/login?next=/settings/account/signature");
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Breadcrumbs items={[{ label: "Account settings", href: "/settings/account" }, { label: "My signature" }]} />
      <div>
        <h1 className="text-3xl font-extrabold">My signature</h1>
        <p className="mt-1 text-ink-soft">The signature you use to sign proposals and contracts for your company. Only you can see or change it.</p>
      </div>
      <MySignature />
    </div>
  );
}
