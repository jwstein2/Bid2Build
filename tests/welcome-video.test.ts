import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { WELCOME_VIDEO, welcomeVideoReady } from "../src/components/onboarding/steps";

const root = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

describe("intro video placeholder", () => {
  it("a published video points at a real file; otherwise every spot shows the placeholder", () => {
    if (welcomeVideoReady()) {
      expect(fs.existsSync(path.join(root, "public", WELCOME_VIDEO.src!))).toBe(true);
    } else {
      expect(WELCOME_VIDEO.src).toBeNull();
      expect(read("src/components/onboarding/onboarding-tour.tsx")).toContain("<VideoPlaceholder");
      expect(read("src/app/(marketing)/bids/[trade]/page.tsx")).toContain("<VideoPlaceholder");
    }
  });

  it("no page hard-codes the retired video file", () => {
    for (const f of ["src/app/(marketing)/page.tsx", "src/app/(marketing)/bids/[trade]/page.tsx", "src/lib/guide/help.ts", "src/components/onboarding/onboarding-tour.tsx"]) {
      expect(read(f)).not.toContain("meet-built2bid-v1.mp4");
    }
    expect(fs.existsSync(path.join(root, "public/media/meet-built2bid-v1.mp4"))).toBe(false);
  });
});
