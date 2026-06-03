import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

/**
 * Auth.js (v5) configuration for the owner deployment.
 *
 * Only ONE GitHub account may sign in: the one named in OWNER_GITHUB_LOGIN. The
 * signIn callback fails closed -- if the env var is unset, or the authenticating
 * profile's login doesn't match, sign-in is rejected. There is no database
 * adapter; sessions are stateless JWTs (encrypted with AUTH_SECRET), which keeps
 * the gate working in edge middleware with no DB on the host.
 *
 * Credentials come from the GitHub OAuth app (GITHUB_CLIENT_ID /
 * GITHUB_CLIENT_SECRET) and AUTH_SECRET. These are set only on the owner Vercel
 * project -- the public deployment and local dev never load this gate (see
 * middleware.ts, which short-circuits unless ATLAS_MODE=owner).
 */
const ownerLogin = process.env.OWNER_GITHUB_LOGIN?.trim().toLowerCase();

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers: [
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
    }),
  ],
  callbacks: {
    signIn({ profile }) {
      if (!ownerLogin) return false; // misconfigured → deny everyone
      const login = (profile as { login?: unknown } | undefined)?.login;
      return typeof login === "string" && login.toLowerCase() === ownerLogin;
    },
  },
});
