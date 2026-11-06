/**
 * Authentication (docs/04, addendum V1.1 "Demo-authenticatie").
 *
 * - demo: Auth.js Credentials provider that only accepts the preset fictitious
 *   test accounts. The browser sends a login name; the server resolves the
 *   user, role and verification status. Nothing else from the request is trusted.
 * - sandbox/production: external OIDC provider. The demo provider is not even
 *   registered, so no request parameter can reach it (AT-35).
 */
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { ensureUserForSubject, findUserIdByAuthSubject, getDb, recordLogin } from "@px/db";
import { isDemoLoginAllowed, loadConfig } from "@px/integrations/env";
import { usedSecondFactor } from "@px/domain";

const cfg = loadConfig(process.env);

const providers = isDemoLoginAllowed(cfg)
  ? [
      Credentials({
        id: "demo",
        name: "Demo-account",
        credentials: { login: { label: "Account", type: "text" } },
        authorize: async (credentials) => {
          // Re-check at request time: never rely on build-time configuration alone.
          if (!isDemoLoginAllowed(loadConfig(process.env))) return null;
          const login = typeof credentials?.login === "string" ? credentials.login : "";
          if (!/^[a-z]{2,20}$/.test(login)) return null;
          // Only preset fictitious test accounts exist under the demo: subject prefix.
          const { db } = getDb();
          const id = await findUserIdByAuthSubject(db, `demo:${login}`);
          if (!id) return null;
          await recordLogin(db, id);
          return { id };
        },
      }),
    ]
  : [
      {
        id: "oidc",
        name: "Inloggen",
        type: "oidc" as const,
        issuer: process.env.OIDC_ISSUER,
        clientId: process.env.OIDC_CLIENT_ID,
        clientSecret: process.env.OIDC_CLIENT_SECRET,
      },
    ];

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers,
  secret: cfg.authSecret,
  session: { strategy: "jwt", maxAge: 8 * 3600 },
  pages: { signIn: "/login" },
  trustHost: cfg.mode === "demo",
  callbacks: {
    async jwt({ token, user, account, profile }) {
      if (account?.provider === "oidc" && profile?.sub) {
        // First OIDC login creates the user; the token keeps only our user id.
        const name = typeof profile.name === "string" ? profile.name : null;
        token.uid = await ensureUserForSubject(getDb().db, `${process.env.OIDC_ISSUER}|${profile.sub}`, name);
        // docs/10: administrators use MFA via the identity provider. We only
        // read the provider's statement (RFC 8176 "amr"); no own MFA protocol.
        token.mfa = usedSecondFactor(profile.amr);
      } else if (user?.id) {
        token.uid = user.id;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user && typeof token.uid === "string") (session.user as { id?: string }).id = token.uid;
      if (session.user) (session.user as { mfa?: boolean }).mfa = token.mfa === true;
      return session;
    },
  },
});
