import { describe, expect, it } from "vitest";
import { canonicalHostRedirect } from "@/lib/config/deploy";

const prod = { NEXT_PUBLIC_DEPLOY_CONTEXT: "production", NEXT_PUBLIC_SITE_URL: "https://built2bid.org" };

describe("canonicalHostRedirect", () => {
  it("sends the production branch alias and the default netlify.app host to built2bid.org", () => {
    expect(canonicalHostRedirect("main--built2bid.netlify.app", prod)).toBe("https://built2bid.org");
    expect(canonicalHostRedirect("built2bid.netlify.app", prod)).toBe("https://built2bid.org");
    expect(canonicalHostRedirect("MAIN--built2bid.netlify.app:443", prod)).toBe("https://built2bid.org");
  });
  it("leaves the real domain alone (no loop)", () => {
    expect(canonicalHostRedirect("built2bid.org", prod)).toBeNull();
    expect(canonicalHostRedirect("www.example.com", prod)).toBeNull();
    expect(canonicalHostRedirect(null, prod)).toBeNull();
  });
  it("leaves deploy permalinks alone", () => {
    expect(canonicalHostRedirect("6740a1b2c3d4e5f6a7b8c9d0--built2bid.netlify.app", prod)).toBeNull();
  });
  it("never redirects previews, branch deploys or local", () => {
    expect(canonicalHostRedirect("deploy-preview-5--built2bid.netlify.app", { ...prod, NEXT_PUBLIC_DEPLOY_CONTEXT: "deploy-preview" })).toBeNull();
    expect(canonicalHostRedirect("staging--built2bid.netlify.app", { ...prod, NEXT_PUBLIC_DEPLOY_CONTEXT: "branch-deploy" })).toBeNull();
    expect(canonicalHostRedirect("main--built2bid.netlify.app", { NEXT_PUBLIC_SITE_URL: "https://built2bid.org" })).toBeNull();
  });
  it("does nothing when the canonical site is itself a netlify.app host", () => {
    expect(canonicalHostRedirect("main--built2bid.netlify.app", { NEXT_PUBLIC_DEPLOY_CONTEXT: "production", NEXT_PUBLIC_SITE_URL: "https://built2bid.netlify.app" })).toBeNull();
  });
});
