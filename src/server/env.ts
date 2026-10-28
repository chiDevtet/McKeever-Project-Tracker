import { z } from "zod";

/**
 * Validated server configuration. Secrets come only from the environment
 * (.env locally, deployment configuration in production); nothing secret is
 * committed. APP_ENV distinguishes production behavior from local runs of a
 * production build (tests), independent of NODE_ENV.
 */
const schema = z
  .object({
    APP_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_URL: z.url().default("http://localhost:3000"),
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    DIRECT_DATABASE_URL: z.string().optional(),
    BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
    STORAGE_DRIVER: z.enum(["local", "r2"]).default("local"),
    LOCAL_STORAGE_DIR: z.string().default("./.data/storage"),
    R2_ACCOUNT_ID: z.string().optional(),
    R2_ACCESS_KEY_ID: z.string().optional(),
    R2_SECRET_ACCESS_KEY: z.string().optional(),
    R2_BUCKET: z.string().optional(),
    R2_ENDPOINT: z.string().optional(),
    MAIL_TRANSPORT: z.enum(["outbox", "smtp"]).default("outbox"),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().default(587),
    SMTP_SECURE: z.stringbool().default(false),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    MAIL_FROM: z.string().default("M&N FieldOps <no-reply@example.com>"),
  })
  .superRefine((v, ctx) => {
    if (v.APP_ENV === "production" && v.MAIL_TRANSPORT === "outbox") {
      ctx.addIssue({ code: "custom", path: ["MAIL_TRANSPORT"], message: "The development mail outbox is not allowed in production; configure SMTP" });
    }
    if (v.MAIL_TRANSPORT === "smtp" && !v.SMTP_HOST) ctx.addIssue({ code: "custom", path: ["SMTP_HOST"], message: "SMTP_HOST is required for smtp mail" });
    if (v.STORAGE_DRIVER === "r2") {
      for (const k of ["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"] as const) {
        if (!v[k]) ctx.addIssue({ code: "custom", path: [k], message: `${k} is required for R2 storage` });
      }
      if (!v.R2_ENDPOINT && !v.R2_ACCOUNT_ID) ctx.addIssue({ code: "custom", path: ["R2_ACCOUNT_ID"], message: "R2_ACCOUNT_ID or R2_ENDPOINT is required" });
    }
  });

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | null = null;

export function env(): ServerEnv {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new Error(`Invalid server configuration: ${detail}`);
    }
    cached = parsed.data;
  }
  return cached;
}
