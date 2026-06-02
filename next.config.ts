import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native module — keep it out of the server bundle.
  serverExternalPackages: ["better-sqlite3"],
  // public-snapshot.json is read via fs at runtime in public mode. Force Next's
  // output file tracing to include it in the serverless bundle (Vercel), or the
  // deployed function 500s with ENOENT.
  outputFileTracingIncludes: {
    "/**/*": ["./public-snapshot.json"],
  },
};

export default nextConfig;
