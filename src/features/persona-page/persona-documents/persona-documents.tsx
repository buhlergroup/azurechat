import { FC, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Label } from "@/features/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/features/ui/tooltip";
import { Info, Trash } from "lucide-react";
import { Button } from "@/features/ui/button";
import { SharePointFilePicker } from "./sharepoint-file-picker";
import { toast } from "@/features/ui/use-toast";
import {
  convertPersonaDocumentToSharePointDocument,
  DocumentMetadata,
  SharePointFile,
} from "../persona-services/models";
import {
  DocumentDetails,
  PersonaDocumentById,
} from "@/features/persona-page/persona-services/persona-documents-service";
import { ErrorDocumentItem } from "@/features/ui/persona-documents/error-document-item";
import { DocumentItem } from "@/features/ui/persona-documents/document-item";

interface Props {
  initialPersonaDocumentIds: readonly string[];
}

export const PersonaDocuments: FC<Props> = ({ initialPersonaDocumentIds }) => {
  const { data: session } = useSession();
  const [pickedFiles, setPickedFiles] = useState<DocumentMetadata[]>([]);
  const [noAccessDocuments, setNoAccessDocuments] = useState<string[]>([]);
  const [documentsToBig, setDocumentsToBig] = useState<DocumentMetadata[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const fetchAllDocuments = async () => {
      if (!initialPersonaDocumentIds || initialPersonaDocumentIds.length === 0)
        return;
      setIsLoading(true);
      const personaDocuments = await fetchPersonaDocuments();
      await fetchMetadataForDocuments(personaDocuments);
      setIsLoading(false);
    };
    fetchAllDocuments();
  }, [initialPersonaDocumentIds]);

  const fetchPersonaDocuments = async (): Promise<SharePointFile[]> => {
    try {
      const responses = await Promise.all(
        initialPersonaDocumentIds.map((id) => PersonaDocumentById(id))
      );

      return responses
        .map((response, index) => {
          if (response.status === "OK") {
            return convertPersonaDocumentToSharePointDocument(
              response.response
            );
          }

          // A document may not be found if the user opens the same persona to fast after deletion of a document
          // because then the persona page was not updated yet.
          if (response.status === "NOT_FOUND") {
            return null;
          }

          handleErrors(
            response.errors,
            `Error fetching document details for ID: ${initialPersonaDocumentIds[index]}. Please try again.`
          );
          return null;
        })
        .filter(Boolean) as SharePointFile[];
    } catch {
      toast({
        title: "Error",
        description: "An unexpected error occurred. Please try again.",
        variant: "destructive",
      });
      return [];
    }
  };

  const fetchMetadataForDocuments = async (
    documents: SharePointFile[]
  ): Promise<void> => {
    if (!initialPersonaDocumentIds) return;

    const response = await DocumentDetails(documents);
    if (response.status === "OK") {
      const unsuccessfulFiles = response.response.unsuccessful.map(
        (file) => file.documentId
      );

      setNoAccessDocuments(unsuccessfulFiles);

      const documentSizeExceeded = documents
        .map((file) => {
          const matchingDocument = response.response.sizeToBig.find(
            (doc) => doc.documentId === file.documentId
          );
          return matchingDocument ? { ...matchingDocument, id: file.id } : null;
        })
        .filter(Boolean) as DocumentMetadata[];

      setDocumentsToBig(documentSizeExceeded as DocumentMetadata[]);

      const updatedFiles = documents
        .map((file) => {
          const matchingDocument = response.response.successful.find(
            (doc) => doc.documentId === file.documentId
          );
          return matchingDocument ? { ...matchingDocument, id: file.id } : null;
        })
        .filter(Boolean);

      setPickedFiles(updatedFiles as DocumentMetadata[]);
    } else {
      handleErrors(
        response.errors,
        "Error fetching document details. Please try again."
      );
    }
  };

  const handleErrors = (
    errors: { message: string }[] | undefined,
    fallback: string
  ) => {
    toast({
      title: "Error",
      description: errors?.map((err) => err.message).join(", ") || fallback,
      variant: "destructive",
    });
  };

  const removeDocument = (file: SharePointFile) => {
    setPickedFiles((prev) =>
      prev.filter((f) => f.documentId !== file.documentId)
    );
  };

  const removeToBigDocument = (file: SharePointFile) => {
    setDocumentsToBig((prev) =>
      prev.filter((f) => f.documentId !== file.documentId)
    );
  };

  const removeNoAccessDocument = (id: string) => {
    setNoAccessDocuments((prev) => prev.filter((f) => f !== id));
  };

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between space-x-2">
        <div className="flex items-center space-x-4">
          <Label>Persona Documents</Label>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info size={15} />
            </TooltipTrigger>
            <TooltipContent>
              <p>Documents that are used when chatting with the persona</p>
            </TooltipContent>
          </Tooltip>
        </div>
        <SharePointFilePicker
          token={session?.user?.accessToken ?? ""}
          tenantUrl={process.env.NEXT_PUBLIC_SHAREPOINT_URL ?? ""}
          onFilesSelected={fetchMetadataForDocuments}
        />
      </div>
      <div className="w-full">
        <input
          type="hidden"
          name="selectedSharePointDocumentIds"
          value={JSON.stringify(pickedFiles)}
        />
        <input
          type="hidden"
          name="personaDocumentIds"
          value={JSON.stringify(initialPersonaDocumentIds)}
        />

        {noAccessDocuments.length > 0 && (
          <ErrorDocumentItem
            title={`You don't have access to ${noAccessDocuments.length} persona document(s)`}
            description={
              "The document(s) may have been deleted or you don't have access to them anymore."
            }
            tooltipContent="Your persona chat experience may suffer from the lack of documents."
            actionIcon={<Trash size={15} className="text-red-500" />}
            action={() => removeNoAccessDocument(noAccessDocuments[0])}
          />
        )}

        {documentsToBig.map((document) => (
          <ErrorDocumentItem
            key={document.documentId}
            title={`The document "${document.name}" exceeds limit of ${process.env.NEXT_PUBLIC_MAX_PERSONA_DOCUMENT_LIMIT} MB`}
            description="This document is too large to be processed."
            tooltipContent="Consider reducing the document size or splitting it into smaller parts."
            actionIcon={<Trash size={15} className="text-red-500" />}
            action={() => removeToBigDocument(document)}
          />
        ))}

        {isLoading ? (
          <div className="p-2 flex items-center justify-center w-full text-muted-foreground">
            Loading documents...
          </div>
        ) : pickedFiles.length === 0 ? (
          <div className="p-2 flex items-center justify-center w-full text-muted-foreground">
            No files selected
          </div>
        ) : (
          <div className="w-full">
            {pickedFiles.map((doc) => (
              <DocumentItem key={doc.documentId} document={doc}>
                <Button
                  size="icon"
                  variant="ghost"
                  type="button"
                  onClick={() => removeDocument(doc)}
                >
                  <Trash size={15} className="text-red-500" />
                </Button>
              </DocumentItem>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
