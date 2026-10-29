import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

export type Db = PrismaClient;
export type Tx = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">;

const globalForPrisma = globalThis as unknown as { __fieldopsPrisma?: PrismaClient };

function create(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const adapter = new PrismaPg({ connectionString, max: Number(process.env.DATABASE_POOL_MAX ?? 10), connectionTimeoutMillis: 10_000 });
  return new PrismaClient({ adapter });
}

function client(): PrismaClient {
  globalForPrisma.__fieldopsPrisma ??= create();
  return globalForPrisma.__fieldopsPrisma;
}

/**
 * Shared Prisma client (one pool per process), created on first use so that
 * importing server modules (for example during `next build`) needs no
 * database configuration.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const c = client();
    const value = Reflect.get(c, prop, c);
    return typeof value === "function" ? value.bind(c) : value;
  },
  has: (_target, prop) => Reflect.has(client(), prop),
});
