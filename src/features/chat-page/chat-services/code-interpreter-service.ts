"use server";
import "server-only";

import { OpenAIV1Instance } from "@/features/common/services/openai";
import { ServerActionResponse } from "@/features/common/server-action-response";
import { logInfo, logError, logDebug } from "@/features/common/services/logger";
import { CODE_INTERPRETER_SUPPORTED_EXTENSIONS } from "./code-interpreter-constants";

/**
 * Upload a file to OpenAI for use with Code Interpreter
 */
export async function UploadFileForCodeInterpreter(
  file: File
): Promise<ServerActionResponse<{ id: string; name: string }>> {
  try {
    const fileExtension = file.name.split(".").pop()?.toUpperCase();
    
    if (!fileExtension || !CODE_INTERPRETER_SUPPORTED_EXTENSIONS.includes(fileExtension)) {
      return {
        status: "ERROR",
        errors: [{ message: `File type .${fileExtension} is not supported for Code Interpreter` }]
      };
    }

    logInfo("Uploading file for Code Interpreter", { 
      fileName: file.name, 
      fileSize: file.size,
      fileType: file.type 
    });

    const openai = OpenAIV1Instance();
    
    // Upload file with purpose "assistants" (required for Code Interpreter)
    const uploadedFile = await openai.files.create({
      file: file,
      purpose: "assistants"
    });

    logInfo("File uploaded successfully", { 
      fileId: uploadedFile.id, 
      fileName: file.name 
    });

    return {
      status: "OK",
      response: {
        id: uploadedFile.id,
        name: file.name
      }
    };
  } catch (error) {
    logError("Failed to upload file for Code Interpreter", {
      error: error instanceof Error ? error.message : String(error),
      fileName: file.name
    });
    
    return {
      status: "ERROR",
      errors: [{ message: `Failed to upload file: ${error instanceof Error ? error.message : String(error)}` }]
    };
  }
}

/**
 * Download a file from OpenAI (e.g., output from Code Interpreter)
 */
export async function DownloadFileFromCodeInterpreter(
  fileId: string
): Promise<ServerActionResponse<{ data: Buffer; name: string; contentType: string }>> {
  try {
    logDebug("Downloading file from Code Interpreter", { fileId });

    const openai = OpenAIV1Instance();
    
    // Get file metadata
    const fileInfo = await openai.files.retrieve(fileId);
    
    // Download file content
    const fileContent = await openai.files.content(fileId);
    const arrayBuffer = await fileContent.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Determine content type from filename
    const extension = fileInfo.filename.split(".").pop()?.toLowerCase() || "";
    const contentTypeMap: Record<string, string> = {
      "csv": "text/csv",
      "json": "application/json",
      "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "pdf": "application/pdf",
      "png": "image/png",
      "jpg": "image/jpeg",
      "jpeg": "image/jpeg",
      "gif": "image/gif",
      "txt": "text/plain",
      "html": "text/html",
      "zip": "application/zip"
    };
    
    const contentType = contentTypeMap[extension] || "application/octet-stream";

    logInfo("File downloaded successfully", { 
      fileId, 
      fileName: fileInfo.filename,
      size: buffer.length 
    });

    return {
      status: "OK",
      response: {
        data: buffer,
        name: fileInfo.filename,
        contentType
      }
    };
  } catch (error) {
    logError("Failed to download file from Code Interpreter", {
      error: error instanceof Error ? error.message : String(error),
      fileId
    });
    
    return {
      status: "ERROR",
      errors: [{ message: `Failed to download file: ${error instanceof Error ? error.message : String(error)}` }]
    };
  }
}

/**
 * Delete a file from OpenAI
 */
export async function DeleteFileFromCodeInterpreter(
  fileId: string
): Promise<ServerActionResponse<boolean>> {
  try {
    logDebug("Deleting file from OpenAI", { fileId });

    const openai = OpenAIV1Instance();
    await openai.files.delete(fileId);

    logInfo("File deleted successfully", { fileId });

    return {
      status: "OK",
      response: true
    };
  } catch (error) {
    logError("Failed to delete file from OpenAI", {
      error: error instanceof Error ? error.message : String(error),
      fileId
    });
    
    return {
      status: "ERROR",
      errors: [{ message: `Failed to delete file: ${error instanceof Error ? error.message : String(error)}` }]
    };
  }
}

