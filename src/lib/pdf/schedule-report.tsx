import "server-only";
import { createElement } from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import type { CustomerReport } from "../schedule/report";
import { ScheduleReportPdf } from "./schedule-report-pdf";

export function renderScheduleReportPdf(r: CustomerReport, version?: number, logo?: { data: Buffer; format: "png" } | null): Promise<Buffer> {
  return renderToBuffer(createElement(ScheduleReportPdf, { r, version, logo }) as React.ReactElement<DocumentProps>);
}

export const PDF_HEADERS = { "content-type": "application/pdf", "cache-control": "private, no-store, max-age=0", "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer" };
