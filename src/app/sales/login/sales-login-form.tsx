"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthDialog } from "@/components/auth/auth-dialog";
import { Button } from "@/components/ui/button";
import { codeRequestedText, emailOtpLength } from "@/lib/auth/config";

/** Email-code sign-in for sales staff. Same secure sign-in as the app; the portal checks the invite. */
export function SalesLoginForm({ next = "/sales" }: { next?: string }) {
  const [open, setOpen] = useState(true);
  const router = useRouter();
  return (
    <div className="mt-6">
      <Button onClick={() => setOpen(true)}>Sign in with email</Button>
      <AuthDialog open={open} onOpenChange={setOpen} next={next} onVerified={() => { router.replace(next); router.refresh(); }}
        copy={{
          title: "Sales team sign in",
          emailDescription: "Use the email address the Built2Bid owner invited. No password needed.",
          sentDescription: (email) => `${codeRequestedText(email, emailOtpLength())} Enter it here to open the sales portal.`,
          phoneDescription: "Use the email address the Built2Bid owner invited.",
          phoneSentDescription: (phone) => `We texted a 6-digit code to ${phone}.`,
          submitLabel: "Verify and sign in",
        }} />
    </div>
  );
}
