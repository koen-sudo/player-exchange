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
import { demoWorld } from "@px/demo";
import { isDemoLoginAllowed, loadConfig } from "@px/integrations/env";

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
          const user = demoWorld().users.find((u) => u.login === login);
          return user ? { id: user.id, name: user.displayName } : null;
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
    jwt({ token, user }) {
      if (user?.id) token.uid = user.id;
      return token;
    },
    session({ session, token }) {
      if (session.user && typeof token.uid === "string") (session.user as { id?: string }).id = token.uid;
      return session;
    },
  },
});
