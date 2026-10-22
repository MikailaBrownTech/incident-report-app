import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins";
import { getCopy } from "@/copy";
import { prisma } from "@/server/db/client";
import { appUrl } from "@/server/env";
import { buildActionEmail, sendEmail } from "@/server/email/send";

/**
 * Email magic-link sign-in only (no social providers yet). BETTER_AUTH_SECRET is read from
 * the environment; the base URL comes from APP_URL (or BETTER_AUTH_URL).
 */
export const auth = betterAuth({
  baseURL: appUrl(),
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  databaseHooks: {
    user: {
      create: {
        // Magic-link sign-up collects only an email, so default the display name to its local part.
        before: async (user) => ({ data: { ...user, name: user.name?.trim() || user.email.split("@")[0] } }),
      },
    },
  },
  plugins: [
    magicLink({
      expiresIn: 60 * 5,
      sendMagicLink: async ({ email, url }) => {
        const t = getCopy("haunted").email; // no workspace yet: pre-login default skin
        await sendEmail(
          buildActionEmail({
            to: email,
            subject: t.magicLinkSubject,
            body: t.magicLinkBody,
            button: t.magicLinkButton,
            url,
            footer: t.ignoreIfNotYou,
          }),
        );
      },
    }),
    nextCookies(), // must stay last
  ],
});
