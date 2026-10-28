import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // Server-only packages with native or dynamic requires stay external to the bundle.
  serverExternalPackages: ["pg", "pg-boss", "@prisma/adapter-pg", "exceljs", "nodemailer", "playwright"],
  // Do not write AGENTS.md into the repository during `next dev`.
  agentRules: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
    ];
  },
};

export default nextConfig;
