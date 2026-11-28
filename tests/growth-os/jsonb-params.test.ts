// postgres.js (used by the Edge Functions) JSON-encodes a parameter whose type Postgres infers as json/jsonb.
// Passing JSON.stringify(x) into `${...}::jsonb` therefore stores a JSON *string* instead of an object (found on
// staging 2026-11-28: OAuth tokens rejected as "no access token", run outputs stored as strings). Always cast via text.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const FILES = ["growth-os/oauth/index.ts", "growth-os/worker/connectors.ts", "growth-os/worker/core.ts", "growth-os/worker/index.ts"];

describe("Edge Function SQL never double-encodes jsonb parameters", () => {
  for (const f of FILES) {
    it(f, () => {
      const src = readFileSync(f, "utf8");
      const bad = src.split("\n").filter((l) => /\}::jsonb/.test(l) && !/\}::text::jsonb/.test(l));
      expect(bad).toEqual([]);
    });
  }
});
