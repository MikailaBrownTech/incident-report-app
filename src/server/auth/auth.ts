import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins";
import { getCopy } from "@/copy";
import { prisma } from "@/server/db/client";
import { buildActionEmail, sendEmail } from "@/server/email/send";

/**
 * Email magic-link sign-in only (no social providers yet). BETTER_AUTH_SECRET and
 * BETTER_AUTH_URL are read from the environment.
 */
export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
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
