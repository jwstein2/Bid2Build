"use client";
import { useState } from "react";
import { AuthDialog } from "@/components/auth/auth-dialog";
import { Button } from "@/components/ui/button";
import { codeRequestedText, emailOtpLength } from "@/lib/auth/config";

/** Email-code sign-in for the owner admin area. Existing accounts only; a full page load picks up the authenticator step. */
export function AdminLoginForm({ next }: { next: string }) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <Button className="w-full" onClick={() => setOpen(true)} data-testid="admin-sign-in">Sign in with email</Button>
      <AuthDialog open={open} onOpenChange={setOpen} next={next} existingOnly onVerified={() => { window.location.assign(next); }}
        copy={{
          title: "Admin sign in",
          emailDescription: "Use the email of your Built2Bid admin account. No password needed.",
          sentDescription: (email) => `${codeRequestedText(email, emailOtpLength())} Enter it here, then you'll enter the code from your authenticator app.`,
          phoneDescription: "Use the email of your Built2Bid admin account.",
          phoneSentDescription: (phone) => `We texted a 6-digit code to ${phone}.`,
          submitLabel: "Verify and continue",
        }} />
    </div>
  );
}
