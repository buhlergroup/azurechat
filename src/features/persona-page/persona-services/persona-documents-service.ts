"use server";
import "server-only";

import {
  ServerActionResponse,
  zodErrorsToServerActionErrors,
} from "@/features/common/server-action-response";
import { getGraphClient } from "../../common/services/microsoft-graph-client";
import { getCurrentUser, userHashedId } from "@/features/auth-page/helpers";
import {
  DocumentMetadata,
  EXTERNAL_SOURCE,
  PERSONA_DOCUMENT_ATTRIBUTE,
  PersonaDocument,
  PersonaDocumentSchema,
  SharePointFile,
  SharePointFileContent,
} from "./models";
import { uniqueId } from "@/features/common/util";
import { HistoryContainer } from "@/features/common/services/cosmos";
import { SqlQuerySpec } from "@azure/cosmos";
import { FindPersonaByID } from "./persona-service";
import {
  DeleteDocumentByPersonaDocumentId,
  IndexDocuments,
  PersonaDocumentExistsInIndex,
} from "@/features/chat-page/chat-services/azure-ai-search/azure-ai-search";
import { DocumentIntelligenceInstance } from "@/features/common/services/document-intelligence";
import { ResponseType } from "@microsoft/microsoft-graph-client";
import { ChunkDocumentWithOverlap } from "@/features/chat-page/chat-services/chat-document-service";
import { SupportedFileExtensionsTextFiles } from "@/features/chat-page/chat-services/models";

export async function DocumentDetails(documents: SharePointFile[]): Promise<
  ServerActionResponse<{
    successful: DocumentMetadata[];
    sizeToBig: DocumentMetadata[];
    unsuccessful: { documentId: string }[];
  }>
> {
  try {
    if (documents.length === 0) {
      return {
        status: "OK",
        response: {
          successful: [],
          unsuccessful: [],
          sizeToBig: [],
        },
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
    const body = CreateDocumentDetailBody(documents, [
      "id",
      "name",
      "createdBy",
      "createdDateTime",
      "parentReference",
      "size",
    ]);
    const response = await client.api("/$batch").post(body);

    let successful: DocumentMetadata[] = [];
    let unsuccessful: { documentId: string }[] = [];
    let sizeToBig: DocumentMetadata[] = [];

    for (const responseItem of response.responses) {
      if (responseItem.status === 200) {
        const document = responseItem.body;

        if (document.size > (Number(process.env.MAX_PERSONA_DOCUMENT_SIZE) || 10485760)) {
          sizeToBig.push({
            documentId: document.id,
            name: document.name,
            createdBy: document.createdBy.user.displayName,
            createdDateTime: document.createdDateTime,
            parentReference: {
              driveId: document.parentReference?.driveId,
            },
          } as DocumentMetadata);
          continue;
        }

        successful.push({
          documentId: document.id,
          name: document.name,
          createdBy: document.createdBy.user.displayName,
          createdDateTime: document.createdDateTime,
          parentReference: {
            driveId: document.parentReference?.driveId,
          },
        } as DocumentMetadata);
      } else {
        unsuccessful.push({
          documentId: responseItem.id,
        });
      }
    }

    return {
      status: "OK",
      response: {
        successful,
        unsuccessful,
        sizeToBig,
      },
    };
  } catch (error) {
    return {
      status: "ERROR",
      errors: [
        {
          message: `Failed to fetch document details: ${error}`,
        },
      ],
    };
  }
}

export const UpdateOrAddPersonaDocuments = async (
  sharePointFiles: DocumentMetadata[],
  currentPersonaDocuments: string[]
): Promise<ServerActionResponse<string[]>> => {
  if (sharePointFiles.length > Number(process.env.MAX_PERSONA_DOCUMENT_LIMIT)) {
    return {
      status: "ERROR",
      errors: [
        {
          message: `Document IDs limit exceeded. Maximum is ${process.env.MAX_PERSONA_DOCUMENT_LIMIT}.`,
        },
      ],
    };
  }

  // create or update documents in the database
  const addOrUpdateResponse = await AddOrUpdatePersonaDocuments(
    sharePointFiles
  );

  if (addOrUpdateResponse.status !== "OK") {
    return {
      status: "ERROR",
      errors: addOrUpdateResponse.errors,
    };
  }

  sharePointFiles.forEach((file, index) => {
    file.id = addOrUpdateResponse.response[index];
  });

  const removeDocuments = currentPersonaDocuments.filter((id) => {
    return !sharePointFiles.map((e) => e.id).includes(id);
  });

  // remove documents that are not selected anymore
  await Promise.all(
    removeDocuments.map(async (id) => {
      await HistoryContainer()
        .item(id, await userHashedId())
        .delete();
    })
  );

  // remove old documents from the vector database
  await Promise.all(
    removeDocuments.map(async (oldDocumentId) => {
      await DeleteDocumentByPersonaDocumentId(oldDocumentId);
    })
  );

  // check if documents are already indexed in vector database
  const newDocuments = [];

  for (const file of sharePointFiles) {
    if (!file.id) {
      return {
        status: "ERROR",
        errors: [
          {
            message: `Document ID is missing.`,
          },
        ],
      };
    }

    const documentResponse = await PersonaDocumentExistsInIndex(file.id);
    if (documentResponse.status === "NOT_FOUND") {
      newDocuments.push(file);
    } else if (documentResponse.status === "ERROR") {
      return {
        status: "ERROR",
        errors: documentResponse.errors,
      };
    }
  }

  const handleNewDocumentsResponse = await IndexNewPersonaDocuments(
    newDocuments
  );

  if (handleNewDocumentsResponse.status !== "OK") {
    return {
      status: "ERROR",
      errors: handleNewDocumentsResponse.errors,
    };
  }

  return {
    status: "OK",
    response: addOrUpdateResponse.response,
  };
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

export const DeletePersonaDocumentsByPersonaId = async (personaId: string) => {
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
    // remove old documents from the vector database
    const deleteResponses = await Promise.all(
      personaDocuments.map(async (oldDocumentId) => {
        return await DeleteDocumentByPersonaDocumentId(oldDocumentId);
      })
    );

    const failedDeletions = deleteResponses.filter(
      (response) => response.status !== "OK"
    );

    if (failedDeletions.length > 0) {
      throw new Error(
        `Failed to delete some persona documents: ${failedDeletions
          .map((failure) => failure.errors?.map((e) => e.message).join(", "))
          .join("; ")}`
      );
    }

    const { resources } = await HistoryContainer()
      .items.query<PersonaDocument>(querySpec)
      .fetchAll();

    for (const document of resources) {
      await HistoryContainer()
        .item(document.id, await userHashedId())
        .delete();
    }
  } catch (error) {
    // throw new Error("Failed to delete persona documents. Error: " + error);
  }
};

export const AuthorizedDocuments = async (
  documents: SharePointFile[]
): Promise<string[]> => {
  try {
    const { token } = await getCurrentUser();
    const client = getGraphClient(token);
    const body = CreateDocumentDetailBody(documents, ["id"]);
    const response = await client.api("/$batch").post(body);

    let allowed: string[] = [];
    response.responses.map((responseItem: any) => {
      if (responseItem.status === 200) {
        allowed.push(
          documents.find((doc) => doc.documentId === responseItem.id)?.id || ""
        );
      }
    });

    return allowed;
  } catch (error) {
    return [];
  }
};

const CreateDocumentDetailBody = (
  documents: SharePointFile[],
  filters: string[]
) => {
  return {
    requests: documents.map((document) => ({
      id: document.documentId,
      method: "GET",
      url: `/drives/${document.parentReference.driveId}/items/${
        document.documentId
      }?$select=${filters.join(",")}`,
    })),
  };
};

const AddOrUpdatePersonaDocuments = async (
  sharePointFiles: SharePointFile[]
): Promise<ServerActionResponse<string[]>> => {
  const personaDocuments: PersonaDocument[] = await Promise.all(
    sharePointFiles.map(async (file) => ({
      id: file.id || uniqueId(),
      userId: await userHashedId(),
      externalFile: {
        documentId: file.documentId,
        parentReference: {
          driveId: file.parentReference.driveId,
        },
      },
      source: EXTERNAL_SOURCE,
      type: PERSONA_DOCUMENT_ATTRIBUTE,
    }))
  );

  const documentIds: string[] = [];

  const validationResponse = ValidatePersonaDocumentSchema(personaDocuments);
  if (validationResponse.status !== "OK") {
    return validationResponse;
  }

  try {
    for (const document of personaDocuments) {
      const upsertedDoc =
        await HistoryContainer().items.upsert<PersonaDocument>(document);
      documentIds.push(upsertedDoc.item.id);
    }
  } catch (error) {
    return {
      status: "ERROR",
      errors: [
        {
          message: `Failed to upsert persona documents. Error: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
      ],
    };
  }

  return {
    status: "OK",
    response: documentIds,
  };
};

const IndexNewPersonaDocuments = async (
  documents: DocumentMetadata[]
): Promise<ServerActionResponse<void>> => {
  // download documents from sharepoint to the server and check access with that
  const downloadFilesFromSharePointResponse = await SharePointFileToText(
    documents
  );

  if (downloadFilesFromSharePointResponse.status !== "OK") {
    return {
      status: downloadFilesFromSharePointResponse.status,
      errors: downloadFilesFromSharePointResponse.errors,
    };
  }

  const splitDocuments = await Promise.all(
    downloadFilesFromSharePointResponse.response.map(async (file) => {
      const result = await ChunkDocumentWithOverlap(file.paragraphs.join("\n"));
      file.chunks = result;
      return file;
    })
  );

  const documentIndexResponses = await Promise.all(
    splitDocuments.map(async (doc) => {
      if (!doc.chunks) {
        return {
          status: "ERROR",
          errors: [
            {
              message: `Document is empty.`,
            },
          ],
        };
      }

      const indexResponses = await IndexDocuments(
        doc.chunks,
        doc.name,
        undefined,
        doc.id
      );

      return indexResponses;
    })
  );

  const allDocumentsIndexed = documentIndexResponses
    .flat()
    .every((r) => r.status === "OK");

  if (!allDocumentsIndexed) {
    return {
      status: "ERROR",
      errors: [
        {
          message: "Problem with indexing persona documents",
        },
      ],
    };
  }

  return {
    status: "OK",
    response: undefined,
  };
};

const SharePointFileToText = async (
  documents: DocumentMetadata[]
): Promise<ServerActionResponse<SharePointFileContent[]>> => {
  const { token } = await getCurrentUser();
  const client = getGraphClient(token);

  try {
    const documentPromises = documents.map(async (document) => {
      const response = (await client
        .api(
          `/drives/${document.parentReference.driveId}/items/${document.documentId}/content`
        )
        .responseType(ResponseType.ARRAYBUFFER)
        .get()) as ArrayBuffer;

      if (response.byteLength === 0) {
        throw new Error(`Document is empty.`);
      }

      if (response.byteLength > Number(process.env.MAX_PERSONA_DOCUMENT_SIZE)) {
        throw new Error(
          `Document ${document.name} is too big. Maximum is ${(
            Number(process.env.MAX_PERSONA_DOCUMENT_SIZE) /
            (1024 * 1024)
          ).toFixed(
            2
          )} MB. Choose a smaller document or split the document into two documents.`
        );
      }

      const fileExtension = document.name.split(".").pop();
      if (fileExtension && IsAlreadyText(fileExtension)) {
        const decoder = new TextDecoder();
        const textContent = decoder.decode(response);

        return {
          ...document,
          paragraphs: [textContent],
        };
      }

      const diClient = DocumentIntelligenceInstance();

      const poller = await diClient.beginAnalyzeDocument(
        "prebuilt-read",
        response
      );

      const { paragraphs } = await poller.pollUntilDone();

      const docs: Array<string> = [];

      if (paragraphs) {
        for (const paragraph of paragraphs) {
          docs.push(paragraph.content);
        }
      }

      return {
        ...document,
        paragraphs: docs,
      };
    });

    try {
      const documentsContent = await Promise.all(documentPromises);
      return {
        status: "OK",
        response: documentsContent,
      };
    } catch (error) {
      return {
        status: "ERROR",
        errors: [
          {
            message: `Failed to download files from SharePoint. Error: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
      };
    }
  } catch (error) {
    return {
      status: "ERROR",
      errors: [
        {
          message: `Failed to download files from SharePoint. Error: ${
            error instanceof Error ? error.message : String(error)
          }`,
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

const ValidatePersonaDocumentSchema = (
  models: PersonaDocument[]
): ServerActionResponse => {
  const errors = [];
  const validModels: PersonaDocument[] = [];

  for (const model of models) {
    const validatedFields = PersonaDocumentSchema.safeParse(model);

    if (!validatedFields.success) {
      errors.push(
        ...zodErrorsToServerActionErrors(validatedFields.error.errors)
      );
    } else {
      validModels.push(validatedFields.data);
    }
  }

  if (errors.length > 0) {
    return {
      status: "ERROR",
      errors,
    };
  }

  return {
    status: "OK",
    response: validModels,
  };
};
