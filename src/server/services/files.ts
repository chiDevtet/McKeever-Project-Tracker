import { createHash, randomUUID } from "node:crypto";
import { canRead, type Viewer } from "@/server/authz";
import { prisma, type Tx } from "@/server/db";
import { notFound } from "@/server/errors";
import { storage } from "@/server/storage/storage";

export type FileKind = "SOURCE_SCHEDULE" | "ATTACHMENT" | "REPORT_PDF" | "REPORT_XLSX" | "LOGO" | "CHART_IMAGE";

export function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  return base.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "").slice(0, 120) || "file";
}

export const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Write bytes to private storage under a new unique key and record metadata. */
export async function storeFile(db: Tx, input: { workspaceId: string; projectId: string | null; kind: FileKind; filename: string; contentType: string; bytes: Uint8Array; immutable: boolean; createdById: string | null }) {
  const id = randomUUID();
  const key = `${input.workspaceId}/${input.projectId ?? "workspace"}/${input.kind.toLowerCase()}/${id}/${safeFilename(input.filename)}`;
  await storage().put(key, input.bytes, input.contentType);
  return db.storedFile.create({
    data: { id, workspaceId: input.workspaceId, projectId: input.projectId, kind: input.kind, storageKey: key, filename: input.filename.slice(0, 255), contentType: input.contentType, sizeBytes: input.bytes.byteLength, sha256: sha256(input.bytes), immutable: input.immutable, createdById: input.createdById },
  });
}

/** Load file bytes after checking the viewer may access the owning project. */
export async function readFileForViewer(viewer: Viewer, fileId: string) {
  const file = await prisma.storedFile.findFirst({ where: { id: fileId, workspaceId: viewer.workspaceId } });
  if (!file) throw notFound("File");
  if (file.projectId && !canRead(viewer, file.projectId)) throw notFound("File");
  if (file.projectId) {
    const project = await prisma.project.findFirst({ where: { id: file.projectId, workspaceId: viewer.workspaceId } });
    if (!project) throw notFound("File");
  }
  const bytes = await storage().get(file.storageKey);
  return { file, bytes };
}
