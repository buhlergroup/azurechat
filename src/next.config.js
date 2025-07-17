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
      bodySizeLimit: "3mb", // default is "1mb" 
    },
  },
  turbopack: {
    // Turbopack handles source maps automatically in dev mode
    rules: {},
  }
};

module.exports = nextConfig;
