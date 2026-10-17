import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root to this directory. Without it Turbopack guesses the
  // root from whichever lockfile it finds walking upward, and a stray lockfile
  // in a parent directory silently changes what gets traced into the bundle.
  turbopack: { root: __dirname },
  // better-sqlite3 is a native module — keep it out of the server bundle.
  serverExternalPackages: ["better-sqlite3"],
  // The snapshots are read via fs at runtime in the deployed modes. Force Next's
  // output file tracing to include them in the serverless bundle (Vercel), or the
  // deployed function 500s with ENOENT. owner-snapshot.json is gitignored and only
  // present when building/deploying the owner project; tracing tolerates its
  // absence on the public build.
  outputFileTracingIncludes: {
    "/**/*": ["./public-snapshot.json", "./owner-snapshot.json"],
  },
  // Don't announce the framework on every response.
  poweredByHeader: false,
  // Static headers for every route. The content security policy carries
  // frame-ancestors only, so it cannot block the app's own inline styles or
  // chart scripts; a full policy needs a nonce and a browser check per route.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        ],
      },
    ];
  },
};

export default nextConfig;
