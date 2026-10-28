"use client";

import type { Procedures } from "@/server/rpc/procedures";

export class RpcError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details: unknown,
  ) {
    super(message);
    this.name = "RpcError";
  }
}

type Input<K extends keyof Procedures> = Parameters<Procedures[K]>[1];
type Output<K extends keyof Procedures> = Awaited<ReturnType<Procedures[K]>>;

/** Call a server operation. The server re-checks authentication, access, and validation. */
export async function rpc<K extends keyof Procedures>(name: K, input: Input<K>): Promise<Output<K>> {
  let res: Response;
  try {
    res = await fetch(`/api/rpc/${name}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input ?? {}), credentials: "same-origin" });
  } catch {
    throw new RpcError("network", "Could not reach the server. Check your connection; your input is kept so you can retry.", 0, null);
  }
  const body = (await res.json().catch(() => null)) as { ok: boolean; result?: unknown; error?: { code: string; message: string; details: unknown } } | null;
  if (!body) throw new RpcError("bad_response", `Unexpected server response (${res.status})`, res.status, null);
  if (!body.ok) throw new RpcError(body.error?.code ?? "error", body.error?.message ?? "Request failed", res.status, body.error?.details ?? null);
  return body.result as Output<K>;
}
