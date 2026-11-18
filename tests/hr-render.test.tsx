import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
import { HrFileView } from "@/components/team/hr-file";
import { HrOverviewView } from "@/components/team/hr-overview";
import { FullTinCard, RequestDocsCard } from "@/components/team/sub-secure";
import { SubDocsForm } from "@/app/sub-docs/[token]/sub-docs-form";
import { mapHrFile, mapHrOverview } from "@/lib/team/hr";

describe("HR and sub screens render", () => {
  it("HR file masks the SSN and shows the sections", () => {
    const file = mapHrFile({ resourceId: "r1", name: "Cris", ssn: { onFile: true, last4: "6789" }, hr: { legal_first_name: "Cristina", employment_status: "active" },
      documents: [{ id: "d1", docType: "i9", hasFile: true, recordedAt: "2026-11-01" }], certifications: [{ id: "c1", name: "OSHA 30", expiresOn: "2026-11-25" }],
      timeOff: [{ id: "t1", kind: "pto", startDate: "2026-07-01", endDate: "2026-07-03", hours: 24, status: "requested" }], balances: { year: 2026, ptoAllowance: 80, ptoUsed: 24 },
      history: [{ action: "ssn.revealed", fields: [], at: "2026-11-18T10:00:00Z", by: "Pam" }] });
    const html = renderToStaticMarkup(<HrFileView file={file} piiReady today="2026-11-18" />);
    expect(html).toContain("•••-••-6789");
    expect(html).toContain("Social Security number viewed");
    expect(html).toContain("56 h left of 80 h");
    expect(html).toContain("Approve");
    expect(renderToStaticMarkup(<HrFileView file={file} piiReady={false} today="2026-11-18" />)).toContain("Coming soon");
  });
  it("overview lists missing paperwork; owner sees HR managers", () => {
    const ov = mapHrOverview({ canManage: true, isOwner: true, managers: [{ userId: "u1", name: "Pam", hr: true }], people: [{ resourceId: "r1", name: "Cris", ssnOnFile: false, emergencyOnFile: true, i9OnFile: true, w4OnFile: false }] });
    const html = renderToStaticMarkup(<HrOverviewView overview={ov} today="2026-11-18" />);
    expect(html).toContain("Missing: SSN, W-4");
    expect(html).toContain("Who can open HR files");
  });
  it("sub screens", () => {
    expect(renderToStaticMarkup(<FullTinCard resourceId="r" status={{ onFile: true, last4: "4321" }} ready tinType="ein" />)).toContain("•••-••-4321");
    expect(renderToStaticMarkup(<RequestDocsCard resourceId="r" requests={[]} defaultEmail="" now={0} />)).toContain("Request documents");
    const form = renderToStaticMarkup(<SubDocsForm token="t" contractor="Acme" subName="Sam" kinds={["w9", "workers_comp"]} w9Available />);
    expect(form).toContain("W-9: request for taxpayer ID");
    expect(form).toContain("Workers&#x27; comp certificate");
  });
});
