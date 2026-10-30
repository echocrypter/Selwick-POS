import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Allow 127.0.0.1 and localhost for Next.js dev server and Electron HMR WebSocket.
  // Next.js 16 blocks cross-origin dev requests by default.
  // Hostname only (no protocol, no port).
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  // Keep development-only data and Electron sources out of the standalone server bundle.
  outputFileTracingExcludes: {
    "*": ["./.data/**/*", "./electron/**/*"],
  },
};

export default nextConfig;
