import { mkdir, readFile, stat, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "@/server/env";

/**
 * Private object storage. Metadata rows (StoredFile) refer to keys here, never
 * to public URLs; every download goes through an access-checked route.
 * Objects are written once under unique keys and never overwritten.
 */
export interface ObjectStorage {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  exists(key: string): Promise<boolean>;
}

const SAFE_KEY = /^[A-Za-z0-9._/-]+$/;

function assertKey(key: string) {
  if (!SAFE_KEY.test(key) || key.includes("..") || key.startsWith("/")) throw new Error(`Unsafe storage key: ${key}`);
}

export class LocalStorage implements ObjectStorage {
  constructor(private readonly root: string) {}

  private resolve(key: string) {
    assertKey(key);
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error("Storage key escapes the storage root");
    return full;
  }

  async put(key: string, body: Uint8Array) {
    const full = this.resolve(key);
    if (await this.exists(key)) throw new Error(`Object already exists: ${key}`);
    await mkdir(path.dirname(full), { recursive: true, mode: 0o700 });
    const tmp = `${full}.${process.pid}.tmp`;
    await writeFile(tmp, body, { mode: 0o600 });
    await rename(tmp, full);
  }

  async get(key: string) {
    return new Uint8Array(await readFile(this.resolve(key)));
  }

  async exists(key: string) {
    try {
      await stat(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }
}

export class R2Storage implements ObjectStorage {
  private readonly client: S3Client;
  constructor(
    private readonly bucket: string,
    endpoint: string,
    accessKeyId: string,
    secretAccessKey: string,
  ) {
    this.client = new S3Client({ region: "auto", endpoint, credentials: { accessKeyId, secretAccessKey } });
  }

  async put(key: string, body: Uint8Array, contentType: string) {
    assertKey(key);
    // IfNoneMatch prevents overwriting an existing object under the same key.
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType, IfNoneMatch: "*" }));
  }

  async get(key: string) {
    assertKey(key);
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!res.Body) throw new Error(`Empty object ${key}`);
    return new Uint8Array(await res.Body.transformToByteArray());
  }

  async exists(key: string) {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }
}

let instance: ObjectStorage | null = null;

export function storage(): ObjectStorage {
  if (instance) return instance;
  const cfg = env();
  if (cfg.STORAGE_DRIVER === "r2") {
    const endpoint = cfg.R2_ENDPOINT || `https://${cfg.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
    instance = new R2Storage(cfg.R2_BUCKET!, endpoint, cfg.R2_ACCESS_KEY_ID!, cfg.R2_SECRET_ACCESS_KEY!);
  } else {
    instance = new LocalStorage(path.resolve(cfg.LOCAL_STORAGE_DIR));
  }
  return instance;
}
