import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { sendMailInBackground } from "@/server/mail/mailer";

/**
 * Better Auth: invite-only email/password with server-managed sessions.
 * Public sign-up is disabled; accounts are created only by accepting an
 * invitation or by the administrator bootstrap command.
 */
function createAuth() {
  const cfg = env();
  return betterAuth({
    appName: "M&N FieldOps",
    baseURL: cfg.APP_URL,
    secret: cfg.BETTER_AUTH_SECRET,
    database: prismaAdapter(prisma, { provider: "postgresql" }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        // Not awaited (avoids timing differences); link goes only to the mail transport.
        sendMailInBackground({
          kind: "password-reset",
          to: user.email,
          subject: "Reset your M&N FieldOps password",
          text: `A password reset was requested for ${user.email}.\n\nReset your password within one hour:\n${url}\n\nIf you did not request this, ignore this message.`,
        });
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    rateLimit: { enabled: cfg.APP_ENV === "production", window: 60, max: 30 },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            const member = await prisma.workspaceMember.findUnique({
              where: { userId: session.userId },
            });
            if (!member || member.disabledAt) return false;
          },
        },
      },
    },
    plugins: [nextCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;
const globalForAuth = globalThis as unknown as { __fieldopsAuth?: Auth };

/** The Better Auth instance, created on first use so builds need no secrets. */
export function getAuth(): Auth {
  globalForAuth.__fieldopsAuth ??= createAuth();
  return globalForAuth.__fieldopsAuth;
}
