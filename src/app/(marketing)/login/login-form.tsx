"use client";
import { useRouter } from "next/navigation";
import { goAfterSignIn } from "@/lib/http/redirect";
import { useState } from "react";
import { AuthDialog, type AuthDialogCopy } from "@/components/auth/auth-dialog";
import { Button } from "@/components/ui/button";
import { isSmsSignInEnabled } from "@/lib/auth/phone";
import { codeRequestedText, emailOtpLength } from "@/lib/auth/config";

/**
 * Plain sign-in wording. The dialog's default copy is written for the builder ("your bid is saved"),
 * which is wrong here: a visitor on /login may have no bid at all, or be on the way to Enterprise.
 */
export function loginCopy(next: string): AuthDialogCopy {
  const enterprise = /[?&]plan=enterprise\b/.test(next);
  const goal = enterprise ? "continue with Team" : "sign in";
  return {
    title: enterprise ? "Verify your email to continue with Team" : "Sign in or create an account",
    emailDescription: enterprise
      ? "No password needed. Your Team selection stays selected, and nothing is charged until you review checkout."
      : "No password needed. New here? Entering your email creates your free account.",
    sentDescription: (email) => `${codeRequestedText(email, emailOtpLength())} Enter it here to ${goal}.`,
    phoneDescription: enterprise ? "Verify your mobile number to continue with Team." : "No password needed. We'll text you a 6-digit code.",
    phoneSentDescription: (phone) => `We texted a 6-digit code to ${phone}. Enter it here to ${goal}.`,
    submitLabel: enterprise ? "Verify and continue" : "Verify and sign in",
  };
}

export function LoginForm({ next }: { next: string }) {
  const [open, setOpen] = useState(true);
  const router = useRouter();
  return (
    <div className="mt-6">
      <Button size="lg" className="w-full" onClick={() => setOpen(true)}>{isSmsSignInEnabled() ? "Continue with phone" : "Continue with email"}</Button>
      <AuthDialog open={open} onOpenChange={setOpen} next={next} copy={loginCopy(next)} onVerified={() => goAfterSignIn(next, router)} />
    </div>
  );
}
