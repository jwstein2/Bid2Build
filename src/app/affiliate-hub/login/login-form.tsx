"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthDialog } from "@/components/auth/auth-dialog";
import { Button } from "@/components/ui/button";
import { goAfterSignIn } from "@/lib/http/redirect";
import { codeRequestedText, emailOtpLength } from "@/lib/auth/config";

/** Email-code sign-in for affiliates (same secure sign-in as the app; the hub checks the affiliate record). */
export function AffiliateLoginForm({ next = "/affiliate-hub", autoOpen = true, label = "Sign in with email" }: { next?: string; autoOpen?: boolean; label?: string }) {
  const [open, setOpen] = useState(autoOpen);
  const router = useRouter();
  return (
    <div className="mt-6">
      <Button onClick={() => setOpen(true)} data-testid="affiliate-sign-in">{label}</Button>
      <AuthDialog open={open} onOpenChange={setOpen} next={next} onVerified={() => goAfterSignIn(next, router)}
        copy={{
          title: "Affiliate sign in",
          emailDescription: "Use the email you applied or were invited with. No password needed.",
          sentDescription: (email) => `${codeRequestedText(email, emailOtpLength())} Enter it here to open the Affiliate Hub.`,
          phoneDescription: "Use the email you applied or were invited with.",
          phoneSentDescription: (phone) => `We texted a 6-digit code to ${phone}.`,
          submitLabel: "Verify and sign in",
        }} />
    </div>
  );
}
