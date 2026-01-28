import { DownloadFileFromCodeInterpreter } from "@/features/chat-page/chat-services/code-interpreter-service";
import { getCurrentUser } from "@/features/auth-page/helpers";
import { logError, logDebug } from "@/features/common/services/logger";
import { NextRequest } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  try {
    // Verify user is authenticated
    const user = await getCurrentUser();
    if (!user) {
      return new Response("Unauthorized", { status: 401 });
    }

    const { fileId } = await params;
    
    if (!fileId) {
      return new Response("File ID is required", { status: 400 });
    }

    logDebug("Downloading Code Interpreter file", { fileId, userEmail: user.email });

    const result = await DownloadFileFromCodeInterpreter(fileId);

    if (result.status !== "OK") {
      return new Response(result.errors[0].message, { status: 404 });
    }

    const { data, name, contentType } = result.response;

    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${name}"`,
        "Content-Length": data.length.toString()
      }
    });
  } catch (error) {
    logError("Error downloading Code Interpreter file", {
      error: error instanceof Error ? error.message : String(error)
    });
    return new Response("Internal Server Error", { status: 500 });
  }
}
