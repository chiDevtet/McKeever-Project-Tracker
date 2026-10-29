import { prisma } from "@/server/db";
import { columnMappingSchema, mapSheetRows, readSheet } from "@/server/imports/extraction";
import { renderPdfPages, runPdfExtractor } from "@/server/imports/python";
import { markExtractionFailed, previewKey, storeExtraction, type PreviewResult } from "@/server/services/imports";
import { storage } from "@/server/storage/storage";
import type { Progress } from "../runner";

/** Extract rows for an import session and store them for review. Never touches a plan. */
export async function extractImport(payload: Record<string, unknown>, progress: Progress) {
  const sessionId = String(payload.sessionId);
  await progress(2, "Reading source file");
  try {
    let lastReported = 0;
    // Page previews render alongside extraction; a preview failure is reported, not fatal.
    const [result, previews] = await Promise.all([
      extractSessionRows(sessionId, (done, total) => {
        const pct = 5 + (done / total) * 85;
        if (pct - lastReported >= 5 || done === total) {
          lastReported = pct;
          void progress(pct, `Extracted page ${done} of ${total}`);
        }
      }),
      renderSessionPreviews(sessionId),
    ]);
    await progress(92, "Comparing with the prior source version");
    return await storeExtraction(sessionId, result, previews);
  } catch (err) {
    await markExtractionFailed(sessionId, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

async function extractSessionRows(sessionId: string, onProgress?: (done: number, total: number) => void) {
  const s = await prisma.importSession.findUniqueOrThrow({ where: { id: sessionId } });
  const file = await prisma.storedFile.findUniqueOrThrow({ where: { id: s.fileId } });
  const bytes = await storage().get(file.storageKey);
  if (s.format === "PDF") return runPdfExtractor(bytes, onProgress);
  const mapping = columnMappingSchema.parse(s.columnMapping);
  const { rows } = await readSheet(bytes, s.format, mapping.sheet);
  return mapSheetRows(rows, mapping);
}

/** Render page previews for a PDF session into private storage (idempotent per source file). */
async function renderSessionPreviews(sessionId: string): Promise<PreviewResult> {
  const s = await prisma.importSession.findUniqueOrThrow({ where: { id: sessionId } });
  if (s.format !== "PDF") return null;
  const file = await prisma.storedFile.findUniqueOrThrow({ where: { id: s.fileId } });
  const store = storage();
  try {
    return await renderPdfPages(await store.get(file.storageKey), async (n, png) => {
      const key = previewKey(file.id, n);
      if (!(await store.exists(key))) await store.put(key, png, "image/png");
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
