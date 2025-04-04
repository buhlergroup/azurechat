import { ServerActionResponse } from '@/features/common/server-action-response';
"use server";
import "server-only";
import { getGraphClient } from "../../common/services/microsoft-graph-client";
import { getCurrentUser } from "@/features/auth-page/helpers";
import { DocumentMetadata, SharePointFile } from "./models";

export async function DocumentDetails(
  documents: SharePointFile[]
): Promise<ServerActionResponse<DocumentMetadata[]>> {
  try {
    if (documents.length === 0) {
      return {
        status: "OK",
        response: [],
      };
    }

    if (documents.length > Number(process.env.MAX_PERSONA_DOCUMENT_LIMIT)) {
      return {
        status: "ERROR",
        errors: [
          {
            message: `Document IDs limit exceeded. Maximum is ${process.env.MAX_PERSONA_DOCUMENT_LIMIT}.`,
          },
        ],
      };
    }

    const { token } = await getCurrentUser();
    const client = getGraphClient(token);
    const body = createDocumentDetailBody(documents);
    const response = await client.api("/$batch").post(body);

    let documentDetails: DocumentMetadata[] = [];
    for (const responseItem of response.responses) {
      if (responseItem.status === 200) {
        const document = responseItem.body;
        documentDetails.push({
          documentId: document.id,
          name: document.name,
          createdBy: document.createdBy.user.displayName,
          createdDateTime: document.createdDateTime,
          parentReference: document.parentReference,
        });
      } else {
        return {
          status: "ERROR",
          errors: [
            {
              message: `Failed to fetch document details. Status: ${responseItem.status}`,
            },
          ],
        };
      }
    }

    return {
      status: "OK",
      response: documentDetails,
    };
  } catch (error: unknown) {
    if (error instanceof Error) {
      return {
        status: "ERROR",
        errors: [
          {
            message: `Failed to fetch document details: ${error.message}`,
          },
        ],
      };
    } else {
      return {
        status: "ERROR",
        errors: [
          {
            message: "Failed to fetch document details: Unknown error",
          },
        ],
      };
    }
  }
}

function createDocumentDetailBody(documents: SharePointFile[]) {
  return {
    requests: documents.map((document) => ({
      id: document.documentId,
      method: "GET",
      url: `/drives/${document.parentReference.driveId}/items/${document.documentId}?$select=id,name,createdBy,createdDateTime,parentReference`,
    })),
  };
}
