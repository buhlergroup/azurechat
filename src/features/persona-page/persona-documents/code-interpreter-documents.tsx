import { FC, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Label } from "@/features/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/features/ui/tooltip";
import { Info, Trash, Code } from "lucide-react";
import { Button } from "@/features/ui/button";
import { CodeInterpreterFilePicker } from "./code-interpreter-file-picker";
import { toast } from "@/features/ui/use-toast";
import {
  DocumentMetadata,
  SharePointFile,
} from "../persona-services/models";
import {
  DocumentDetails,
  PersonaCIDocumentById,
} from "@/features/persona-page/persona-services/persona-ci-documents-service";
import { ErrorDocumentItem } from "@/features/ui/persona-documents/error-document-item";
import { DocumentItem } from "@/features/ui/persona-documents/document-item";

interface Props {
  initialCIDocumentIds: string[];
}

export const CodeInterpreterDocuments: FC<Props> = ({ initialCIDocumentIds }) => {
  const { data: session } = useSession();
  const [pickedFiles, setPickedFiles] = useState<DocumentMetadata[]>([]);
  const [noAccessDocuments, setNoAccessDocuments] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const fetchAllDocuments = async () => {
      if (!initialCIDocumentIds || initialCIDocumentIds.length === 0)
        return;
      setIsLoading(true);
      const ciDocuments = await fetchCIDocuments();
      await fetchMetadataForDocuments(ciDocuments);
      setIsLoading(false);
    };
    fetchAllDocuments();
  }, [initialCIDocumentIds]);

  const fetchCIDocuments = async (): Promise<SharePointFile[]> => {
    try {
      const responses = await Promise.all(
        initialCIDocumentIds.map((id) => PersonaCIDocumentById(id))
      );

      return responses
        .map((response, index) => {
          if (response.status === "OK") {
            return {
              id: response.response.id,
              documentId: response.response.externalFile.documentId,
              parentReference: response.response.externalFile.parentReference,
            };
          } else if (response.status === "NOT_FOUND") {
            setNoAccessDocuments((prev) => [
              ...prev,
              initialCIDocumentIds[index],
            ]);
            return null;
          }
          return null;
        })
        .filter((file): file is SharePointFile => file !== null);
    } catch {
      displayToastError("An unexpected error occurred. Please try again.");
      return [];
    }
  };

  const fetchMetadataForDocuments = async (
    files: SharePointFile[]
  ): Promise<void> => {
    if (!files || files.length === 0) {
      setPickedFiles([]);
      return;
    }

    try {
      const result = await DocumentDetails(files);

      if (result.status === "OK") {
        const { successful, unsuccessful } = result.response;
        setPickedFiles(successful);

        if (unsuccessful.length > 0) {
          setNoAccessDocuments((prev) => [
            ...prev,
            ...unsuccessful.map((doc) => doc.documentId),
          ]);
        }
      } else {
        displayToastError(
          result.errors?.map((e) => e.message).join(", ") ||
            "An unexpected error occurred"
        );
      }
    } catch {
      displayToastError("An unexpected error occurred. Please try again.");
    }
  };

  const handleFilesSelected = async (
    selectedFiles: SharePointFile[]
  ): Promise<void> => {
    await fetchMetadataForDocuments(selectedFiles);
  };

  const displayToastError = (message: string) => {
    toast({
      title: "Error",
      description: message,
      variant: "destructive",
    });
  };

  const handleRemove = (documentId: string): void => {
    setPickedFiles((current) =>
      current.filter((f) => f.documentId !== documentId)
    );
  };

  return (
    <div className="flex flex-col gap-2 w-full">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 flex-1">
          <Code size={18} />
          <Label className="font-semibold">Code Interpreter Documents</Label>
          <Tooltip>
            <TooltipTrigger type="button">
              <Info size={15} />
            </TooltipTrigger>
            <TooltipContent>
              <p>Files for Code Interpreter (Excel, CSV, images, etc.) - loaded when chat starts</p>
            </TooltipContent>
          </Tooltip>
        </div>
        <CodeInterpreterFilePicker
          token={session?.user?.accessToken ?? ""}
          tenantUrl={process.env.NEXT_PUBLIC_SHAREPOINT_URL ?? ""}
          onFilesSelected={handleFilesSelected}
        />
      </div>
      <div className="w-full">
        <input
          type="hidden"
          name="selectedCIDocumentIds"
          value={JSON.stringify(pickedFiles)}
        />
        <input
          type="hidden"
          name="ciDocumentIds"
          value={JSON.stringify(initialCIDocumentIds)}
        />

        {noAccessDocuments.length > 0 && (
          <ErrorDocumentItem
            title={`You don't have access to ${noAccessDocuments.length} Code Interpreter document(s)`}
            description={
              "The document(s) may have been deleted or you don't have access to them anymore."
            }
            tooltipContent="Your persona chat experience may suffer from the lack of documents."
          />
        )}

        {isLoading ? (
          <div className="p-2 flex items-center justify-center w-full text-muted-foreground">
            Loading documents...
          </div>
        ) : pickedFiles.length === 0 ? (
          <div className="p-2 flex items-center justify-center w-full text-muted-foreground">
            No Code Interpreter files selected
          </div>
        ) : (
          pickedFiles.map((doc) => (
            <DocumentItem key={doc.documentId} document={doc}>
              <Button
                onClick={() => handleRemove(doc.documentId)}
                size={"icon"}
                variant={"ghost"}
                type="button"
              >
                <Trash size={15} />
              </Button>
            </DocumentItem>
          ))
        )}
      </div>
    </div>
  );
};
