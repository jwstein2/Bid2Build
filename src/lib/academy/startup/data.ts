import { FEDERAL, STATE_FILES } from "./data/index";
import { buildGuide, type Guide } from "./guide";
import type { StateFile } from "./types";

export const startupStates = (): string[] => Object.keys(STATE_FILES).sort();
export const stateFile = (state: string | null | undefined): StateFile | null => (state && STATE_FILES[state]) || null;

/** The guide for a state and trade, or null when that state hasn't been researched yet. */
export function guideFor(state: string | null | undefined, trade: string | null | undefined): Guide | null {
  const file = stateFile(state);
  return file ? buildGuide(file, FEDERAL, trade ?? null) : null;
}

/** Course slug of a trade's "Starting a ... business" Classroom course. */
export const startingCourseSlug = (trade: string) => `${trade}-getting-started`;
