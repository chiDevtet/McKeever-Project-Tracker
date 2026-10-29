import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReportDataset } from "@/domain/report";
import { ReportDocument } from "./document";

/** Complete standalone HTML for the print renderer (no scripts, no external resources). */
export function reportHtml(ds: ReportDataset): string {
  const body = renderToStaticMarkup(createElement(ReportDocument, { ds }));
  const title = `${ds.identity.projectCode} ${ds.identity.title}`.replace(/[<>&"]/g, "");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><title>${title}</title></head><body>${body}</body></html>`;
}
