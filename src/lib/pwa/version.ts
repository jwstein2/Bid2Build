/**
 * V10.1 desktop app: the running build's identifier, and the "is there a newer production release?" check.
 *
 * The installed app (Chrome/Edge/Safari web app) loads the same production site as the browser. HTML is never cached
 * (Cache-Control: no-store) and there is no offline copy of the app, so every launch already gets the current release.
 * The only thing that can run "old" code is a window left open across a deploy: that window asks /api/version now and
 * then and offers "Built2Bid has been updated. Refresh to use the latest version."
 */

/** This build's id, inlined at build time (Netlify DEPLOY_ID, else the commit). Empty in local dev and tests. */
export const CLIENT_BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? "";

export type VersionInfo = {
  /** The build the server is running now. */
  build: string;
  /** Urgent (security) release: windows on any other build must refresh before they keep working. */
  required: boolean;
};

/** Parse /api/version safely; anything unexpected reads as "no information" (never as an update). */
export function parseVersionInfo(raw: unknown): VersionInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.build !== "string" || !r.build) return null;
  return { build: r.build, required: r.required === true };
}

export type UpdateState = "current" | "available" | "required";

/** What the open window should show, given its own build and what the server reports. Exported for tests. */
export function updateStateFor(clientBuild: string, server: VersionInfo | null): UpdateState {
  // Local dev / unknown build: never nag.
  if (!clientBuild || !server) return "current";
  if (server.build === clientBuild) return "current";
  return server.required ? "required" : "available";
}

/** True when an error is the browser failing to load a script chunk from an older deploy. Exported for tests. */
export function isChunkLoadError(reason: unknown): boolean {
  const text = reason instanceof Error ? `${reason.name} ${reason.message}` : typeof reason === "string" ? reason : "";
  return /ChunkLoadError|Loading chunk [\w-]+ failed|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(text);
}

/**
 * Install promotion switch (menu item, account card, after-purchase card). On unless
 * BUILT2BID_DESKTOP_INSTALL_ENABLED is "off"/"false"/"0". It only hides the invitations: people who already installed
 * keep the app, and the app keeps working, because the app *is* the website.
 */
export function isDesktopInstallPromoEnabled(value = process.env.NEXT_PUBLIC_DESKTOP_INSTALL): boolean {
  const v = (value ?? "").trim().toLowerCase();
  return !(v === "off" || v === "false" || v === "0");
}
