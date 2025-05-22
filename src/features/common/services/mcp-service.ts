"use server";
import "server-only";

import { ServerActionResponse } from "@/features/common/server-action-response";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
let client: Client | undefined = undefined;

export const DiscoverMCPFunctions = async (
  discoveryURL: string
): Promise<ServerActionResponse> => {
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

    const result = tools.tools;

    return {
      status: "OK",
      response: {
        result,
      },
    };
  } catch (error) {
    console.log(error);

    return {
      status: "ERROR",
      errors: [
        {
          message:
            "Discovery of the MCP Server faild. Check the discovery url.",
        },
      ],
    };
  }
};
