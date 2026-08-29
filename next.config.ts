import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Status updates accept multiple supporting documents in one Server Action.
    // The framework default is 1 MB, which is too small for ordinary PDFs.
    serverActions: {
      bodySizeLimit: '25mb',
    },
  },
};

export default nextConfig;
