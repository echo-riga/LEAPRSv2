import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: "/admin", destination: "/portal", permanent: true },
      { source: "/admin/:path*", destination: "/portal/:path*", permanent: true },
    ];
  },
  experimental: {
    // Status updates accept multiple supporting documents in one Server Action.
    // The framework default is 1 MB, which is too small for ordinary PDFs.
    serverActions: {
      bodySizeLimit: "25mb",
    },
  },
};

export default nextConfig;
