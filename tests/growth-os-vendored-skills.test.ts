import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = "growth-os/skills/vendor";
type Source = { dir: string; repo: string; commit: string; license: string; skills: string[]; files: Record<string, string> };
const manifest = JSON.parse(readFileSync(join(DIR, "manifest.json"), "utf8")) as { sources: Source[] };

function walk(d: string): string[] {
  return readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
}

describe("vendored Growth OS skills", () => {
  const onDisk = manifest.sources.flatMap((s) => walk(join(DIR, s.dir)).map((p) => relative(DIR, p)));

  it("pins every source to a full commit sha and an MIT licence", () => {
    for (const s of manifest.sources) {
      expect(s.commit).toMatch(/^[0-9a-f]{40}$/);
      expect(s.license).toBe("MIT");
      expect(s.files[`${s.dir}/LICENSE`]).toBeTruthy();
    }
  });

  it("matches the manifest exactly (no unlisted, missing or edited files)", () => {
    const listed = manifest.sources.flatMap((s) => Object.keys(s.files));
    expect(onDisk.sort()).toEqual(listed.sort());
    for (const s of manifest.sources)
      for (const [p, sha] of Object.entries(s.files))
        expect(createHash("sha256").update(readFileSync(join(DIR, p))).digest("hex"), p).toBe(sha);
  });

  it("contains instruction files only", () => {
    for (const p of onDisk) expect(p, p).toMatch(/(\.md|\/LICENSE)$/);
  });

  it("has a SKILL.md for every listed skill", () => {
    for (const s of manifest.sources) for (const k of s.skills) expect(s.files[`${s.dir}/${k}/SKILL.md`], `${s.dir}/${k}`).toBeTruthy();
  });
});
