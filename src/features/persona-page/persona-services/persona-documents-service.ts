"use server";
import "server-only";

import { ServerActionResponse } from "@/features/common/server-action-response";
import { getGraphClient } from "../../common/services/microsoft-graph-client";
import { getCurrentUser } from "@/features/auth-page/helpers";
import {
  DocumentMetadata,
  EXTERNAL_SOURCE,
  PersonaDocument,
  SharePointFile,
} from "./models";
import { uniqueId } from "@/features/common/util";
import { HistoryContainer } from "@/features/common/services/cosmos";
import { SqlQuerySpec } from "@azure/cosmos";
import { FindPersonaByID } from "./persona-service";

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
          parentReference: {
            driveId: document.parentReference?.driveId,
          },
        } as DocumentMetadata);
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

export const UpdateOrAddPersonaDocuments = async (
  sharePointFiles: SharePointFile[]
): Promise<string[]> => {
  // TODO
  // check if the the user as access to the documents here on the server + get the download urls

  // send needed documents to document Intellicence

  // chunk personaDocuments

  // index documents

  // create documents in the database
  const personaDocuments: PersonaDocument[] = sharePointFiles.map((file) => ({
    id: file.id || uniqueId(),
    externalFile: {
      documentId: file.documentId,
      parentReference: {
        driveId: file.parentReference.driveId,
      },
    },
    source: EXTERNAL_SOURCE,
  }));

  const documentIds: string[] = [];

  try {
    for (const document of personaDocuments) {
      const upsertedDoc =
        await HistoryContainer().items.upsert<PersonaDocument>(document);
      documentIds.push(upsertedDoc.item.id);
    }
  } catch (error) {
    throw new Error("Failed to upsert persona documents. Error: " + error);
  }

  return documentIds;
};

export const PersonaDocumentById = async (
  id: string
): Promise<ServerActionResponse<PersonaDocument>> => {
  const querySpec: SqlQuerySpec = {
    query: "SELECT * FROM root r WHERE r.id=@id",
    parameters: [
      {
        name: "@id",
        value: id,
      },
    ],
  };
  try {
    const { resources } = await HistoryContainer()
      .items.query<PersonaDocument>(querySpec)
      .fetchAll();

    if (resources.length === 0) {
      return {
        status: "NOT_FOUND",
        errors: [
          {
            message: "Persona Document not found",
          },
        ],
      };
    }

    return {
      status: "OK",
      response: resources[0],
    };
  } catch (error) {
    return {
      status: "ERROR",
      errors: [
        {
          message: `Error creating persona: ${error}`,
        },
      ],
    };
  }
};

export const DeletePersonaDocumentsByPersonaId = async (
  personaId: string
) => {
  const persona = await FindPersonaByID(personaId);

  if (persona.status !== "OK") {
    throw new Error("Persona not found");
  }

  const personaDocuments = persona.response.personaDocumentIds;
  if (!personaDocuments || personaDocuments.length === 0) {
    return;
  }

  const querySpec: SqlQuerySpec = {
    query: `SELECT * FROM root r WHERE ARRAY_CONTAINS(@ids, r.id)`,
    parameters: [
      {
        name: "@ids",
        value: personaDocuments,
      },
    ],
  };

  try {
    const { resources } = await HistoryContainer()
      .items.query<PersonaDocument>(querySpec)
      .fetchAll();

    for (const document of resources) {
      await HistoryContainer().item(document.id).delete();
    }
  } catch (error) {
    throw new Error("Failed to delete persona documents. Error: " + error);
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
