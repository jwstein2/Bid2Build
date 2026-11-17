import { describe, expect, it, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Minimal browser storage for the local-draft helpers.
const store = new Map<string, string>();
(globalThis as unknown as { window: unknown }).window = {
  localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
};
const { saveLocalDraft, deleteLocalDraft, unsavedLocalDrafts, listLocalDrafts } = await import("@/lib/drafts/local");
const draft = (id: string, title = id) => ({ estimate: { id, title } as never, proposalConfig: {} as never });

describe("dashboard 'saved only on this device' banner", () => {
  beforeEach(() => store.clear());

  it("lists a draft started signed out (not in the account)", () => {
    saveLocalDraft(draft("a"));
    expect(unsavedLocalDrafts([]).map((d) => d.id)).toEqual(["a"]);
  });

  it("ignores old safety copies of bids already saved in the account (written before this fix)", () => {
    store.set("byb:drafts", JSON.stringify([{ id: "saved", title: "Saved bid", savedAt: "2026-11-16T00:00:00Z" }, { id: "local", title: "Local", savedAt: "2026-11-16T00:00:00Z" }]));
    expect(unsavedLocalDrafts(["saved"]).map((d) => d.id)).toEqual(["local"]);
    expect(listLocalDrafts()).toHaveLength(2); // hidden, never deleted
  });

  it("lists an account bid only while it has edits the server hasn't confirmed", () => {
    saveLocalDraft(draft("cloud"), { origin: "cloud" });
    expect(unsavedLocalDrafts(["cloud"]).map((d) => d.id)).toEqual(["cloud"]);
    deleteLocalDraft("cloud"); // what the builder does after a successful save
    expect(unsavedLocalDrafts(["cloud"])).toEqual([]);
  });
});

describe("builder writes", () => {
  const src = fs.readFileSync(path.resolve(import.meta.dirname, "../src/components/builder/builder.tsx"), "utf8");
  it("skips the safety copy when a saved bid is only opened", () => {
    expect(src).toMatch(/const openedClean = useRef\(cloudMode\)/);
    expect(src).toMatch(/if \(openedClean\.current\) \{ openedClean\.current = false; return; \}/);
  });
  it("marks account-bid copies as cloud and drops them after a confirmed save of the latest state", () => {
    expect(src).toMatch(/origin: cloudMode \? "cloud" : "local"/);
    expect(src).toMatch(/latest\.current\.estimate === estimate && latest\.current\.config === config\) deleteLocalDraft\(estimate\.id\)/);
  });
  it("dashboard passes the account's bid ids", () => {
    const page = fs.readFileSync(path.resolve(import.meta.dirname, "../src/app/(app)/dashboard/page.tsx"), "utf8");
    expect(page).toMatch(/<LocalDraftsBanner accountIds=\{ests\.map\(\(e\) => e\.id\)\} \/>/);
  });
});
