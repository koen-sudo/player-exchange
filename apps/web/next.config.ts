import type { NextConfig } from "next";

// The mode/configuration guard (AT-35) runs in src/instrumentation.ts at
// server startup, where workspace TypeScript packages are compiled by Next.

const config: NextConfig = {
  transpilePackages: ["@px/domain", "@px/demo", "@px/integrations", "@px/db"],
  serverExternalPackages: ["pg"],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default config;
