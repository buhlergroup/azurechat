"use server";
import "server-only";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
let client: Client | undefined = undefined;

export const DiscoverMCPFunctions = async (discoveryURL: string) => {
  // Discover mcp tools
  try {
    client = new Client({
      name: "streamable-http-client",
      version: "1.0.0",
    });
    const transport = new StreamableHTTPClientTransport(new URL(discoveryURL));
    await client.connect(transport);
    console.log("Connected using Streamable HTTP transport");
    const tools = await client.listTools();
    console.log("Discovered tools:", tools);
    
  } catch (error) {
    // If that fails with a 4xx error, try the older SSE transport
    console.log(error)
    console.log(
      "Streamable HTTP connection failed, falling back to SSE transport"
    );
  }
};
