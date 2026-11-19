"use client";
import { Button } from "../ui/button";
import { GET_TEAM_EVENT } from "./enterprise-plan";

/**
 * "Get Team" on the plan cards: starts Team checkout in one click (email verification for visitors,
 * the company step for signed-in contractors) on the Team card below, with the plan kept selected.
 */
export function GetTeamButton({ label = "Get Team" }: { label?: string }) {
  return (
    <Button size="lg" className="w-full" data-cta="get-team" onClick={() => window.dispatchEvent(new Event(GET_TEAM_EVENT))}>
      {label}
    </Button>
  );
}
