"use client";
import { useRouter } from "next/navigation";
import { goAfterSignIn } from "@/lib/http/redirect";
import { useState } from "react";
import { AuthDialog } from "@/components/auth/auth-dialog";
import { Button } from "@/components/ui/button";
import { codeRequestedText, emailOtpLength } from "@/lib/auth/config";

/** Email-code sign-in for sales staff. Same secure sign-in as the app; the portal checks the invite. */
export function SalesLoginForm({ next = "/sales", autoOpen = true, label = "Sign in with email", invite = false }: { next?: string; autoOpen?: boolean; label?: string; invite?: boolean }) {
  const [open, setOpen] = useState(autoOpen);
  const router = useRouter();
  return (
    <div className="mt-6">
      <Button onClick={() => setOpen(true)} data-testid="sales-sign-in">{label}</Button>
      <AuthDialog open={open} onOpenChange={setOpen} next={next} onVerified={() => goAfterSignIn(next, router)}
        copy={{
          title: invite ? "Join the Built2Bid sales team" : "Sales team sign in",
          emailDescription: invite ? "New here? Use the email your invite was sent to. Already have a Built2Bid account? Use its email. We'll email you a code, no password needed." : "Use the email address the Built2Bid owner invited. No password needed.",
          sentDescription: (email) => `${codeRequestedText(email, emailOtpLength())} Enter it here to ${invite ? "join and open your Sales Hub" : "open the sales portal"}.`,
          phoneDescription: "Use the email address the Built2Bid owner invited.",
          phoneSentDescription: (phone) => `We texted a 6-digit code to ${phone}.`,
          submitLabel: "Verify and sign in",
        }} />
    </div>
  );
}
