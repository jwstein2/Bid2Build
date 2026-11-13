"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Two-step delete for saved customers, cost items and assemblies: the first tap asks
 * "Delete <name>?" in place, the second runs the server action. Same pattern as the bid list.
 */
export function ConfirmDelete({ action, fields, name }: { action: (fd: FormData) => Promise<void>; fields: Record<string, string>; name: string }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return <button type="button" onClick={() => setAsking(true)} className="-my-2 min-h-11 px-2 text-sm text-danger hover:underline" aria-label={`Delete ${name}`}>Delete</button>;
  }
  return (
    <form action={action} className="flex flex-wrap items-center gap-1 text-sm" role="group" aria-label={`Confirm deleting ${name}`}>
      {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <span className="mr-1 text-ink-soft">Delete {name}?</span>
      <Button size="sm" variant="danger" type="submit" autoFocus>Delete</Button>
      <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>Cancel</Button>
    </form>
  );
}
