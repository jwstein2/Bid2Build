import { it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { LIFECYCLE_STEPS, renderLifecycle } from "@/lib/email/lifecycle";

// Writes the five lifecycle emails (example data) as HTML for owner review:
//   OUT=/path npx vitest run -c scripts/growth/vitest.samples.mts scripts/growth/lifecycle-previews.gen.ts
it("renders lifecycle email previews", () => {
  const out = process.env.OUT ?? "lifecycle-previews";
  fs.mkdirSync(out, { recursive: true });
  for (const step of LIFECYCLE_STEPS) {
    const r = renderLifecycle({
      appUrl: "https://built2bid.org", step, trade: "decks",
      estimateId: step === "b" || step === "c" ? "00000000-0000-4000-8000-000000000000" : null,
      unsubscribeUrl: "https://built2bid.org/email/unsubscribe?u=example&s=example",
      postalAddress: "[postal address (PO Box or mailbox), set in Netlify]",
    });
    const banner = `<div style="font:13px sans-serif;background:#f4f4f4;padding:8px 24px;color:#333">Email ${step.toUpperCase()} · Subject: <b>${r.subject.replace(/</g, "&lt;")}</b></div>`;
    fs.writeFileSync(path.join(out, `email-${step}.html`), r.html.replace(/<body([^>]*)>/, `<body$1>${banner}`));
    fs.writeFileSync(path.join(out, `email-${step}.txt`), `Subject: ${r.subject}\n\n${r.text}`);
  }
});
