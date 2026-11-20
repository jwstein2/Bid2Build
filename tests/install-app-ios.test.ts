import { describe, expect, it } from "vitest";
import { iosBrowser } from "@/components/marketing/install-app-button";

const ios = (os: string, tail: string) =>
  `Mozilla/5.0 (iPhone; CPU iPhone OS ${os} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) ${tail}`;

describe("iosBrowser", () => {
  it.each([
    ["Safari (iOS 26 frozen UA)", ios("18_6", "Version/26.0 Mobile/15E148 Safari/604.1"), "safari"],
    ["Safari iOS 15", ios("15_8", "Version/15.6 Mobile/15E148 Safari/604.1"), "safari"],
    ["Chrome", ios("18_6", "CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1"), "chrome"],
    ["Firefox", ios("17_4", "FxiOS/132.0 Mobile/15E148 Safari/605.1.15"), "firefox"],
    ["Edge", ios("17_4", "EdgiOS/131.0.2903.68 Version/17.0 Mobile/15E148 Safari/604.1"), "edge"],
    ["Chrome on iOS 16.2", ios("16_2", "CriOS/120.0 Mobile/15E148 Safari/604.1"), "old"],
    ["Facebook", ios("18_6", "Mobile/15E148 [FBAN/FBIOS;FBAV/490.0.0.0;FBBV/1;FBDV/iPhone15,2]"), "inapp"],
    ["Instagram", ios("18_6", "Mobile/15E148 Instagram 350.0.0.0 (iPhone15,2; iOS 18_6)"), "inapp"],
    ["Google app", ios("18_6", "GSA/340.0.0 Mobile/15E148 Safari/604.1"), "inapp"],
  ])("%s", (_name, ua, want) => {
    expect(iosBrowser(ua)).toBe(want);
  });
});
