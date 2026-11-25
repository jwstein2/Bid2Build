import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button } from "@/components/ui/button";

/** Instant save feedback (2026-11-25): a busy Button shows a spinner, is disabled and is marked busy. */
describe("Button loading state", () => {
  it("shows a spinner, disables the button and sets aria-busy while loading", () => {
    const html = renderToStaticMarkup(createElement(Button, { loading: true }, "Saving…"));
    expect(html).toContain("animate-spin");
    expect(html).toMatch(/disabled=""/);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Saving…");
  });

  it("renders a plain button when not loading", () => {
    const html = renderToStaticMarkup(createElement(Button, { onClick: async () => {} }, "Save"));
    expect(html).not.toContain("animate-spin");
    expect(html).not.toMatch(/disabled=""/);
    expect(html).not.toContain("aria-busy=");
  });

  it("keeps an explicitly disabled button disabled", () => {
    expect(renderToStaticMarkup(createElement(Button, { disabled: true }, "Save"))).toMatch(/disabled=""/);
  });
});
