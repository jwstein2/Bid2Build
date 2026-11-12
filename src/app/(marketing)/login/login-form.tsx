"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthDialog } from "@/components/builder/dialogs";
import { Button } from "@/components/ui/button";

export function LoginForm({ next }: { next: string }) {
  const [open, setOpen] = useState(true);
  const router = useRouter();
  return (
    <div className="mt-6">
      <Button size="lg" className="w-full" onClick={() => setOpen(true)}>Continue with email</Button>
      <AuthDialog title="Log in or sign up" open={open} onOpenChange={setOpen} next={next} onVerified={() => { router.replace(next); router.refresh(); }} />
    </div>
  );
}
