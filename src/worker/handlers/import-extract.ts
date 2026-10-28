import { extractSessionRows, markExtractionFailed, renderSessionPreviews, storeExtraction } from "@/server/services/imports";
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
