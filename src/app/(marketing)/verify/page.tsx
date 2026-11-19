import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";
import { VerifyForm } from "./verify-form";

export const metadata: Metadata = {
  title: "Check a signed document",
  description: "Confirm that a signed proposal PDF from Built2Bid hasn't been changed since it was signed.",
  alternates: { canonical: "/verify" },
};

export default function VerifyPage() {
  return (
    <LegalPage title="Check a signed document" updated="November 19, 2026">
      <p>Choose a signed proposal PDF that was downloaded from a Built2Bid signing link. Your browser calculates the file&apos;s fingerprint (SHA-256) on your device and sends only that fingerprint. The file itself is never uploaded.</p>
      <p>If the fingerprint matches our records, the file is exactly the signed copy we produced. If even one character was changed, it won&apos;t match. A printed or re-saved copy also won&apos;t match, so check the original download.</p>
      <VerifyForm />
    </LegalPage>
  );
}
