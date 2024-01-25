import { registerOTel } from "@vercel/otel";

export async function register() {
  // eslint-disable-next-line react-hooks/rules-of-hooks

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    registerOTel("Bühler ChatGPT");
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const { useAzureMonitor } = require("@azure/monitor-opentelemetry");
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useAzureMonitor({
        azureMonitorExporterOptions: {
            connectionString: process.env.APPLICATIONINSIGHTS_CONNECTION_STRING,
        }
    });
  }
}
