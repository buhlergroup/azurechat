import { refineFromEmpty } from "@/features/common/schema-validation";
import { z } from "zod";

export const EXTERNAL_SOURCE = "SHAREPOINT";

export type PersonaDocument = z.infer<typeof PersonaDocumentSchema>;

export type SharePointFile = {
  id?: string; // PersonaDocument ID
  documentId: string; // SharePoint document ID
  parentReference: {
    driveId: string;
  };
}
export const SharePointFileSchema = z.object({
  documentId: z.string(), // SharePoint document ID
  parentReference: z.object({
    driveId: z.string(),
  }),
});

export const PersonaDocumentSchema = z.object({
  id: z.string(),
  externalFile: SharePointFileSchema,
  source: z.literal(EXTERNAL_SOURCE),
});

export const AccessGroupSchema = z.object({
  id: z.string(),
  source: z.literal(EXTERNAL_SOURCE),
});

export const PERSONA_ATTRIBUTE = "PERSONA";
export type PersonaModel = z.infer<typeof PersonaModelSchema>;

export const PersonaModelSchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z
    .string({
      invalid_type_error: "Invalid title",
    })
    .min(1)
    .refine(refineFromEmpty, "Title cannot be empty"),
  description: z
    .string({
      invalid_type_error: "Invalid description",
    })
    .min(1)
    .refine(refineFromEmpty, "Description cannot be empty"),
  personaMessage: z
    .string({
      invalid_type_error: "Invalid persona Message",
    })
    .min(1)
    .refine(refineFromEmpty, "System message cannot be empty"),
  extensionIds: z.array(z.string()),
  isPublished: z.boolean(),
  type: z.literal(PERSONA_ATTRIBUTE),
  createdAt: z.date(),
  personaDocumentIds: z.array(z.string()).optional(),
  accessGroup: AccessGroupSchema.optional(),
});


export type AccessGroup = {
  id: string;
  name: string;
  description: string;
};

export type DocumentMetadata = SharePointFile & {
  name: string;
  createdBy: string;
  createdDateTime: string;
};

export const convertDocumentMetadataToSharePointFile = (file: DocumentMetadata): SharePointFile => {
  return {
    id: file.id,
    documentId: file.documentId,
    parentReference: file.parentReference,
  };
}

export const convertPersonaDocumentToSharePointDocument = (file: PersonaDocument): SharePointFile => {
  return {
    id: file.id,
    documentId: file.externalFile.documentId,
    parentReference: file.externalFile.parentReference,
  };
}