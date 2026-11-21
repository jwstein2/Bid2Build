import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LEGAL_DOCUMENTS } from "@/lib/legal/registry";

/**
 * The Google Drive copy of the published legal pages is kept current by an Apps Script
 * (docs/legal/drive-sync/LegalDriveSync.gs, see docs/legal/GOOGLE_DRIVE_SYNC.md). It only syncs the pages
 * listed in its PAGES array, so every public page in the legal registry must be listed there.
 */
const script = readFileSync(join(__dirname, "..", "docs", "legal", "drive-sync", "LegalDriveSync.gs"), "utf8");
const pagesBlock = script.slice(script.indexOf("const PAGES = ["), script.indexOf("];", script.indexOf("const PAGES = [")));
const syncedPaths = [...pagesBlock.matchAll(/\['([^']+)',\s*'([^']+)'\]/g)].map((m) => "/" + m[1]);

describe("legal Drive sync", () => {
  it("parses the script's page list", () => {
    expect(syncedPaths.length).toBeGreaterThan(5);
  });

  it("syncs every public legal page in the registry", () => {
    const publicPages = LEGAL_DOCUMENTS.filter((d) => d.public && d.category !== "in_product").map((d) => d.href);
    const missing = publicPages.filter((href) => !syncedPaths.includes(href));
    expect(missing, "add these to PAGES in docs/legal/drive-sync/LegalDriveSync.gs").toEqual([]);
  });
});
