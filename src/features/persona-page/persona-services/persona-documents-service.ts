"use server";
import "server-only";
import { getGraphClient } from "../../common/services/microsoft-graph-client";
import { getCurrentUser } from "@/features/auth-page/helpers";
import { DocumentMetadata, SharePointPickedFile } from "./models";

export async function DocumentDetails(
  documents: SharePointPickedFile[]
): Promise<DocumentMetadata[]> {
  try {
    if (documents.length === 0) {
      return [];
    }

    if (documents.length > Number(process.env.MAX_PERSONA_DOCUMENT_LIMIT)) {
      throw new Error(
        `Document IDs limit exceeded. Maximum is ${process.env.MAX_PERSONA_DOCUMENT_LIMIT}.`
      );
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
          id: document.id,
          name: document.name,
          createdBy: document.createdBy.user.displayName,
          createdDateTime: document.createdDateTime,
          parentReference: document.parentReference,
        });
      } else {
        throw new Error(
          `Failed to fetch document details. Status: ${responseItem.status}`
        );
      }
    }

    return documentDetails;
  } catch (error: unknown) {
    if (error instanceof Error) {
      throw new Error(`Failed to fetch document details: ${error.message}`);
    } else {
      throw new Error("Failed to fetch document details: Unknown error");
    }
  }
}

function createDocumentDetailBody(documents: SharePointPickedFile[]) {
  return {
    requests: documents.map((document) => ({
      id: document.id,
      method: "GET",
      url: `/drives/${document.parentReference.driveId}/items/${document.id}?$select=id,name,createdBy,createdDateTime, parentReference`,
    })),
  };
}
