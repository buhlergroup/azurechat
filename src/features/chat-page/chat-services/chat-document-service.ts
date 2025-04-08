"use server";
import "server-only";

import { userHashedId } from "@/features/auth-page/helpers";
import { HistoryContainer } from "@/features/common/services/cosmos";

import { RevalidateCache } from "@/features/common/navigation-helpers";
import { ServerActionResponse } from "@/features/common/server-action-response";
import { DocumentIntelligenceInstance } from "@/features/common/services/document-intelligence";
import { isUnexpected, getLongRunningPoller, AnalyzeOperationOutput } from "@azure-rest/ai-document-intelligence";
import { uniqueId } from "@/features/common/util";
import { SqlQuerySpec } from "@azure/cosmos";
import { EnsureIndexIsCreated } from "./azure-ai-search/azure-ai-search";
import {
  CHAT_DOCUMENT_ATTRIBUTE,
  ChatDocumentModel,
  SupportedFileExtensionsDocumentIntellicence,
  SupportedFileExtensionsTextFiles,
} from "./models";

const MAX_UPLOAD_DOCUMENT_SIZE: number = 10000000; // 10MB in bytes
const CHUNK_SIZE = 2300;
// 25% overlap
const CHUNK_OVERLAP = CHUNK_SIZE * 0.25;

export const CrackDocument = async (
  formData: FormData
): Promise<ServerActionResponse<string[]>> => {
  try {
    const response = await EnsureIndexIsCreated();
    if (response.status !== "OK") return response;

    const file = formData.get("file") as unknown as File;
    const fileExtension = file.name.split(".").pop();
    if (fileExtension && IsAlreadyText(fileExtension)) {
      const text = await file.text();
      const splitDocuments = await ChunkDocumentWithOverlap(text);

      return {
        status: "OK",
        response: splitDocuments,
      };
    }

    const fileResponse = await LoadFile(formData);
    if (fileResponse.status !== "OK") return fileResponse;

    const splitDocuments = await ChunkDocumentWithOverlap(
      fileResponse.response.join("\n")
    );

    return {
      status: "OK",
      response: splitDocuments,
    };
  } catch (e) {
    return {
      status: "ERROR",
      errors: [
        {
          message: `${e}`,
        },
      ],
    };
  }
};

const IsAlreadyText = (extension: string) => {
  if (!extension) return false;
  return Object.values(SupportedFileExtensionsTextFiles).includes(
    extension.toUpperCase() as SupportedFileExtensionsTextFiles
  );
};

const LoadFile = async (
  formData: FormData
): Promise<ServerActionResponse<string[]>> => {
  try {
    const file: File | null = formData.get("file") as unknown as File;

    const fileExtension = file.name.split(".").pop();

    if (!isSupportedFileType(fileExtension)) {
      throw new Error("Unsupported File Type");
    }

    const fileSize = process.env.MAX_UPLOAD_DOCUMENT_SIZE
      ? Number(process.env.MAX_UPLOAD_DOCUMENT_SIZE)
      : MAX_UPLOAD_DOCUMENT_SIZE;

    if (file && file.size < fileSize) {
      const client = DocumentIntelligenceInstance();
      const arrayBuffer = await file.arrayBuffer();
      const base64Source = Buffer.from(arrayBuffer).toString('base64');

      const initialResponse = await client
        .path("/documentModels/{modelId}:analyze", "prebuilt-layout")
        .post({
          contentType: "application/json",
          body: { base64Source },
          queryParameters: { outputContentFormat: "markdown" },
          onUploadProgress: (progress) => {
            console.log(`Upload progress: ${progress.loadedBytes} bytes`);
          },
          onDownloadProgress: (progress) => {
            console.log(`Download progress: ${progress.loadedBytes} bytes`);
          }
        });

      if (isUnexpected(initialResponse)) {
        throw initialResponse.body.error;
      }

      const docs: Array<string> = [];

      const poller = getLongRunningPoller(client, initialResponse, {
        intervalInMs: 1000,
      });
      const response =  await poller.pollUntilDone();

      return {
        status: "OK",
        response: [(response.body as AnalyzeOperationOutput)?.analyzeResult?.content as string],
      };
    } else {
      return {
        status: "ERROR",
        errors: [
          {
            message: `File is too large and must be less than ${MAX_UPLOAD_DOCUMENT_SIZE} bytes.`,
          },
        ],
      };
    }
  } catch (e) {
    return {
      status: "ERROR",
      errors: [
        {
          message: `${e}`,
        },
      ],
    };
  }
};

const isSupportedFileType = (extension: string | undefined): boolean => {
  if (!extension) return false;
  return Object.values(SupportedFileExtensionsDocumentIntellicence).includes(
    extension.toUpperCase() as SupportedFileExtensionsDocumentIntellicence
  );
};

export const FindAllChatDocuments = async (
  chatThreadID: string
): Promise<ServerActionResponse<ChatDocumentModel[]>> => {
  try {
    const querySpec: SqlQuerySpec = {
      query:
        "SELECT * FROM root r WHERE r.type=@type AND r.chatThreadId = @threadId AND r.isDeleted=@isDeleted",
      parameters: [
        {
          name: "@type",
          value: CHAT_DOCUMENT_ATTRIBUTE,
        },
        {
          name: "@threadId",
          value: chatThreadID,
        },
        {
          name: "@isDeleted",
          value: false,
        },
      ],
    };

    const { resources } = await HistoryContainer()
      .items.query<ChatDocumentModel>(querySpec)
      .fetchAll();

    if (resources) {
      return {
        status: "OK",
        response: resources,
      };
    } else {
      return {
        status: "ERROR",
        errors: [
          {
            message: "No documents found",
          },
        ],
      };
    }
  } catch (e) {
    return {
      status: "ERROR",
      errors: [
        {
          message: `${e}`,
        },
      ],
    };
  }
};

export const CreateChatDocument = async (
  fileName: string,
  chatThreadID: string
): Promise<ServerActionResponse<ChatDocumentModel>> => {
  try {
    const modelToSave: ChatDocumentModel = {
      chatThreadId: chatThreadID,
      id: uniqueId(),
      userId: await userHashedId(),
      createdAt: new Date(),
      type: CHAT_DOCUMENT_ATTRIBUTE,
      isDeleted: false,
      name: fileName,
    };

    const { resource } =
      await HistoryContainer().items.upsert<ChatDocumentModel>(modelToSave);
    RevalidateCache({
      page: "chat",
      params: chatThreadID,
    });

    if (resource) {
      return {
        status: "OK",
        response: resource,
      };
    }

    return {
      status: "ERROR",
      errors: [
        {
          message: "Unable to save chat document",
        },
      ],
    };
  } catch (e) {
    return {
      status: "ERROR",
      errors: [
        {
          message: `${e}`,
        },
      ],
    };
  }
};

export async function ChunkDocumentWithOverlap(
  document: string
): Promise<string[]> {
  const chunks: string[] = [];

  if (document.length <= CHUNK_SIZE) {
    // If the document is smaller than the desired chunk size, return it as a single chunk.
    chunks.push(document);
    return chunks;
  }

  let startIndex = 0;

  // Split the document into chunks of the desired size, with overlap.
  while (startIndex < document.length) {
    const endIndex = startIndex + CHUNK_SIZE;
    const chunk = document.substring(startIndex, endIndex);
    chunks.push(chunk);
    startIndex = endIndex - CHUNK_OVERLAP;
  }

  return chunks;
}
