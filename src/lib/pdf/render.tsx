import "server-only";
import { renderToBuffer } from "@react-pdf/renderer";
import type { ProposalDocument } from "../proposal/types";
import { ProposalPdf } from "./proposal-pdf";

export async function renderProposalPdf(doc: ProposalDocument, logo?: { data: Buffer; format: "png" | "jpg" } | null): Promise<Buffer> {
  return renderToBuffer(<ProposalPdf doc={doc} logo={logo} />);
}

export function pdfFilename(doc: ProposalDocument, version?: number): string {
  const slug = (s: string) => s.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 40) || "proposal";
  return `${slug(doc.brand.companyName)}_${slug(doc.meta.title)}_${slug(doc.meta.number)}${version ? `_v${version}` : ""}.pdf`;
}
