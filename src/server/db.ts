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

/** Shared Prisma client (one pool per process). */
export const prisma: PrismaClient = globalForPrisma.__fieldopsPrisma ?? create();
if (process.env.NODE_ENV !== "production") globalForPrisma.__fieldopsPrisma = prisma;
