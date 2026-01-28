/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  distDir: "build",
  serverExternalPackages: [
    "@azure/storage-blob",
    "@azure/monitor-opentelemetry",
    "@opentelemetry/api",
    "@opentelemetry/instrumentation",
    "@opentelemetry/sdk-trace-base",
  ],
  images: {
    // Configure image sizes and qualities for Next.js 16
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    qualities: [75, 100],
    localPatterns: [
      {
        pathname: '/**',
      },
    ],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb", // increased from 3mb to support larger file uploads
    },
    turbopackUseSystemTlsCerts: true,
  },
};

module.exports = nextConfig;
