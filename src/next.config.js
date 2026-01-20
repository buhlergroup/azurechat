/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  serverExternalPackages: [
    "@azure/storage-blob",
    "@azure/monitor-opentelemetry",
    "@opentelemetry/api",
    "@opentelemetry/instrumentation",
    "@opentelemetry/sdk-trace-base",
  ],
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb", // increased from 3mb to support larger file uploads
    },
    turbopackUseSystemTlsCerts: true,
  },
};

module.exports = nextConfig;
