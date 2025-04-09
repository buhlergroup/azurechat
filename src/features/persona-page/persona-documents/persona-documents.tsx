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

interface Props {
  initialPersonaDocumentIds: readonly string[];
}

export const PersonaDocuments: FC<Props> = ({ initialPersonaDocumentIds }) => {
  const { data: session } = useSession();
  const [pickedFiles, setPickedFiles] = useState<DocumentMetadata[]>([]);
  const [noAccessDocuments, setNoAccessDocuments] = useState<string[]>([]);

  useEffect(() => {
    const fetchAllDocuments = async () => {
      const personaDocuments = await fetchPersonaDocuments();
      await fetchMetadataForDocuments(personaDocuments);
    };
    fetchAllDocuments();
  }, [initialPersonaDocumentIds]);

  const fetchPersonaDocuments = async (): Promise<SharePointFile[]> => {
    if (!initialPersonaDocumentIds) return [];
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
          } else {
            handleErrors(
              response.errors,
              `Error fetching document details for ID: ${initialPersonaDocumentIds[index]}. Please try again.`
            );
            return null;
          }
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
          <div className="flex items-center space-x-2 justify-between border rounded-md p-2 mb-2 border-red-200 bg-background">
            <div>
              <p>
                You don't have access to {noAccessDocuments.length} persona
                document(s)
              </p>
              <div className="flex items-center space-x-2 mt-1">
                <p className="text-sm text-muted-foreground">
                  The document(s) may have been deleted or you don't have access
                  to them anymore.
                </p>
              </div>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="p-1 text-red-500">
                  <Info size={15} />
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>
                  Your persona chat experience may suffer from the lack of
                  documents
                </p>
              </TooltipContent>
            </Tooltip>
          </div>
        )}

        {pickedFiles.length === 0 ? (
          <div className="p-2 flex items-center justify-center w-full text-muted-foreground">
            No files selected
          </div>
        ) : (
          <div className="w-full">
            {pickedFiles.map((file) => (
              <div
                key={file.documentId}
                className="flex items-center justify-between space-x-2 border rounded-md p-2 mb-2 border-input bg-background"
              >
                <div>
                  <p>{file.name}</p>
                  <div className="flex items-center space-x-2 mt-1 text-sm text-muted-foreground">
                    <p>
                      {new Date(file.createdDateTime).toLocaleDateString(
                        "de-CH"
                      )}
                    </p>
                    <span>|</span>
                    <p>{file.createdBy}</p>
                  </div>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  type="button"
                  onClick={() => removeDocument(file)}
                >
                  <Trash size={15} className="text-red-500" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
