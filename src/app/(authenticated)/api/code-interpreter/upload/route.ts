import { UploadFileForCodeInterpreter } from "@/features/chat-page/chat-services/code-interpreter-service";
import { isCodeInterpreterSupportedFile } from "@/features/chat-page/chat-services/code-interpreter-constants";
import { getCurrentUser } from "@/features/auth-page/helpers";
import { logError, logInfo } from "@/features/common/services/logger";

export async function POST(request: Request) {
  try {
    // Verify user is authenticated
    const user = await getCurrentUser();
    if (!user) {
      return new Response("Unauthorized", { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return new Response(JSON.stringify({ error: "No file provided" }), { 
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Check file size (max 512MB for Code Interpreter)
    const maxSize = 512 * 1024 * 1024; // 512MB
    if (file.size > maxSize) {
      return new Response(JSON.stringify({ 
        error: `File size exceeds maximum allowed (512MB)` 
      }), { 
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Check if file type is supported
    if (!isCodeInterpreterSupportedFile(file.name)) {
      return new Response(JSON.stringify({ 
        error: `File type not supported for Code Interpreter` 
      }), { 
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    logInfo("Uploading file for Code Interpreter", { 
      fileName: file.name, 
      fileSize: file.size,
      userEmail: user.email 
    });

    const result = await UploadFileForCodeInterpreter(file);

    if (result.status !== "OK") {
      return new Response(JSON.stringify({ 
        error: result.errors[0].message 
      }), { 
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ 
      id: result.response.id,
      name: result.response.name
    }), { 
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    logError("Error uploading file for Code Interpreter", {
      error: error instanceof Error ? error.message : String(error)
    });
    return new Response(JSON.stringify({ 
      error: "Internal Server Error" 
    }), { 
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
