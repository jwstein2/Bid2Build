import { describe, expect, it } from "vitest";
import { matchesAccept, pickDroppedFiles } from "@/components/ui/file-drop";

const f = (name: string, type: string) => ({ name, type });

describe("matchesAccept", () => {
  it("accepts anything when accept is empty", () => {
    expect(matchesAccept(f("a.exe", "application/x-msdownload"), "")).toBe(true);
  });
  it("matches exact MIME types, wildcards and extensions case-insensitively", () => {
    const logo = "image/png,image/jpeg,image/webp";
    expect(matchesAccept(f("Logo.PNG", "image/png"), logo)).toBe(true);
    expect(matchesAccept(f("logo.gif", "image/gif"), logo)).toBe(false);
    expect(matchesAccept(f("x.heic", "image/heic"), "image/*,application/pdf")).toBe(true);
    expect(matchesAccept(f("bank.QFX", ""), ".csv,.ofx,.qfx,text/csv")).toBe(true);
    expect(matchesAccept(f("bank.pdf", "application/pdf"), ".csv,.ofx,.qfx,text/csv")).toBe(false);
  });
});

describe("pickDroppedFiles", () => {
  it("keeps only the first matching file for single-file inputs", () => {
    const r = pickDroppedFiles([f("a.txt", "text/plain"), f("b.png", "image/png"), f("c.png", "image/png")], "image/png", false);
    expect(r.error).toBeNull();
    expect(r.files.map((x) => x.name)).toEqual(["b.png"]);
  });
  it("keeps every matching file for multi-file inputs", () => {
    const r = pickDroppedFiles([f("a.jpg", "image/jpeg"), f("b.pdf", "application/pdf"), f("c.png", "image/png")], "image/*", true);
    expect(r.files.map((x) => x.name)).toEqual(["a.jpg", "c.png"]);
  });
  it("explains when nothing dropped is allowed", () => {
    expect(pickDroppedFiles([f("a.gif", "image/gif")], "image/png", false).error).toMatch(/can't be uploaded here/);
  });
});
