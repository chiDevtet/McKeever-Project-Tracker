import { viewerFromHeaders } from "@/server/authz";
import { errorResponse } from "@/server/rpc/http";
import { readFileForViewer } from "@/server/services/files";

export const dynamic = "force-dynamic";

/** Access-checked private file download (never a public URL). */
export async function GET(req: Request, ctx: { params: Promise<{ fileId: string }> }) {
  try {
    const viewer = await viewerFromHeaders(req.headers);
    if (!viewer) return Response.json({ ok: false, error: { code: "unauthenticated", message: "Sign in to continue." } }, { status: 401 });
    const { fileId } = await ctx.params;
    const { file, bytes } = await readFileForViewer(viewer, fileId);
    const inline = new URL(req.url).searchParams.get("inline") === "1" && (file.contentType === "application/pdf" || file.contentType.startsWith("image/"));
    const ascii = file.filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
    return new Response(Buffer.from(bytes), {
      headers: {
        "content-type": file.contentType,
        "content-length": String(bytes.byteLength),
        "content-disposition": `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        // Chrome's PDF viewer does not render under a sandbox policy; other types are sandboxed.
        "content-security-policy": file.contentType === "application/pdf" ? "default-src 'none'" : "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
