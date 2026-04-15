/** @type {import('next').NextConfig} */
const nextConfig = {
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
