import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["playwright", "pino", "pino-pretty"],
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals.push("playwright");
    }
    return config;
  },
};

export default nextConfig;
