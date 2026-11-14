"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthDialog } from "@/components/auth/auth-dialog";
import { Button } from "@/components/ui/button";
import { isSmsSignInEnabled } from "@/lib/auth/phone";

export function LoginForm({ next }: { next: string }) {
  const [open, setOpen] = useState(true);
  const router = useRouter();
  return (
    <div className="mt-6">
      <Button size="lg" className="w-full" onClick={() => setOpen(true)}>{isSmsSignInEnabled() ? "Continue with phone" : "Continue with email"}</Button>
      <AuthDialog title="Log in or sign up" open={open} onOpenChange={setOpen} next={next} onVerified={() => { router.replace(next); router.refresh(); }} />
    </div>
  );
}
