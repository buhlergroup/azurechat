import { CHAT_DEFAULT_SYSTEM_PROMPT } from "@/features/theme/theme-config";
import { Button } from "@/features/ui/button";
import { Label } from "@/features/ui/label";
import { ScrollArea } from "@/features/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/features/ui/sheet";
import { Copy, Info, VenetianMask } from "lucide-react";
import { FC, useEffect, useState } from "react";
import { ChatThreadModel } from "../chat-services/models";
import { personaStore } from "@/features/persona-page/persona-store";
import { useRouter } from "next/navigation";
import { FindChatThreadForCurrentUser } from "../chat-services/chat-thread-service";
import { showError } from "@/features/globals/global-message-store";
import {
  convertPersonaDocumentToSharePointDocument,
  DocumentMetadata,
  SharePointFile,
} from "@/features/persona-page/persona-services/models";
import {
  DocumentDetails,
  PersonaDocumentById,
} from "@/features/persona-page/persona-services/persona-documents-service";
import { toast } from "@/features/ui/use-toast";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/features/ui/tooltip";
import { ErrorDocumentItem } from "@/features/ui/persona-documents/error-document-item";
import { DocumentItem } from "@/features/ui/persona-documents/document-item";

interface Props {
  chatThread: ChatThreadModel;
}

export const PersonaDetail: FC<Props> = ({ chatThread }) => {
  const [documents, setDocuments] = useState<DocumentMetadata[]>([]);
  const [noAccessDocuments, setNoAccessDocuments] = useState<
    { documentId: string }[]
  >([]);

  const { personaMessageTitle, personaMessage, personaDocumentIds, id } =
    chatThread;
  const router = useRouter();

  useEffect(() => {
    const initializeDocuments = async () => {
      const personaDocuments = await fetchPersonaDocuments(personaDocumentIds);
      fetchDocumentMetadata(personaDocuments);
    };
    initializeDocuments();
  }, [personaDocumentIds]);

  const fetchPersonaDocuments = async (
    documentIds: string[]
  ): Promise<SharePointFile[]> => {
    if (!documentIds || documentIds.length === 0) return [];

    try {
      const responses = await Promise.all(
        documentIds.map((id) => PersonaDocumentById(id))
      );

      const notAvailableDocuments = responses.filter(
        (response) => response.status === "NOT_FOUND"
      );

      setNoAccessDocuments(
        notAvailableDocuments.map((response) => ({
          documentId: "notAvailable",
        }))
      );

      const availableDocuments = responses.filter(
        (response) => response.status === "OK"
      );

      return availableDocuments.map((response, index) => {
        return convertPersonaDocumentToSharePointDocument(response.response);
      });
    } catch {
      displayToastError("An unexpected error occurred. Please try again.");
      return [];
    }
  };

  const fetchDocumentMetadata = async (
    files: SharePointFile[]
  ): Promise<void> => {
    if (!files || files.length === 0) return;

    try {
      const response = await DocumentDetails(files);

      if (response.status === "OK") {
        processDocumentMetadata(
          {
            successful: response.response.successful,
            unsuccessful: response.response.unsuccessful,
          },
          files
        );
      } else {
        displayError(
          response.errors,
          "Error fetching document details. Please try again."
        );
      }
    } catch {
      displayToastError("An unexpected error occurred. Please try again.");
    }
  };

  const processDocumentMetadata = (
    response: {
      successful: DocumentMetadata[];
      unsuccessful: { documentId: string }[];
    },
    files: SharePointFile[]
  ) => {
    const updatedFiles = files
      .map((file) => {
        const match = response.successful.find(
          (doc) => doc.documentId === file.documentId
        );
        return match ? { ...match, id: file.id } : null;
      })
      .filter(Boolean) as DocumentMetadata[];

    setDocuments(updatedFiles);
    setNoAccessDocuments(response.unsuccessful || []);

    if (response.unsuccessful.length > 0) {
      displayToastWarning(
        "Some documents are not accessible",
        "Your persona chat experience may suffer from the lack of documents."
      );
    }
  };

  const handleDuplicateAndCustomize = async () => {
    try {
      const chatThread = await FindChatThreadForCurrentUser(id);

      if (chatThread.status !== "OK") {
        return showError("An error occurred while duplicating the agent.");
      }

      const duplicatePersona = {
        name: `${personaMessageTitle} Copy`,
        description: `Copy of ${personaMessageTitle}`,
        personaMessage,
        extensionIds: chatThread.response.extension,
      };

      personaStore.newPersonaAndOpen(duplicatePersona);
      router.push("/agent");
    } catch {
      showError("An unexpected error occurred while duplicating the agent.");
    }
  };

  const displayError = (errors: any, fallbackMessage: string) => {
    const description =
      errors?.map((err: any) => err.message).join(", ") || fallbackMessage;
    displayToastError(description);
  };

  const displayToastError = (description: string) => {
    toast({
      title: "Error",
      description,
      variant: "destructive",
    });
  };

  const displayToastWarning = (title: string, description: string) => {
    toast({
      title,
      description,
      variant: "default",
    });
  };

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          aria-label="Current Chat Persona Menu"
        >
          <VenetianMask size={16} />
        </Button>
      </SheetTrigger>
      <SheetContent className="min-w-[480px] sm:w-[540px] flex flex-col">
        <SheetHeader>
          <SheetTitle>Persona</SheetTitle>
        </SheetHeader>
        <ScrollArea className="flex-1 -mx-6 flex" type="always">
          <div className="pb-6 px-6 flex gap-8 flex-col flex-1">
            <div className="grid gap-2">
              <Label>Name</Label>
              <div>{personaMessageTitle}</div>
            </div>
            <div className="grid gap-2 flex-1">
              <Label>Personality</Label>
              <div className="whitespace-pre-wrap">
                {CHAT_DEFAULT_SYSTEM_PROMPT}
              </div>
              <div className="whitespace-pre-wrap">{personaMessage}</div>
            </div>
            <PersonaDocumentsSection
              documents={documents}
              noAccessDocumentsCount={noAccessDocuments.length}
            />
          </div>
        </ScrollArea>
        <div className="mt-auto pt-4 border-t">
          <Button
            variant="default"
            size="sm"
            onClick={handleDuplicateAndCustomize}
            className="gap-2 w-full"
          >
            <Copy size={16} />
            <p>Duplicate & Customise</p>
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
};

const PersonaDocumentsSection: FC<{
  documents: DocumentMetadata[];
  noAccessDocumentsCount: number;
}> = ({ documents, noAccessDocumentsCount }) => {
  return (
    <div className="grid gap-2 flex-1">
      <Label>Persona Documents</Label>
      <TooltipProvider>
        {noAccessDocumentsCount > 0 && (
          <ErrorDocumentItem
            title={`You don't have access to ${noAccessDocumentsCount} persona document(s)`}
            description="Ask the persona owner to share the document(s) with you"
            tooltipContent="Your persona chat experience may suffer from the lack of documents."
          />
        )}
        {documents.length === 0 && (
          <div className="p-2 flex items-center justify-center w-full text-muted-foreground">
            No files selected
          </div>
        )}
        {documents.map((doc) => (
          <DocumentItem key={doc.documentId} document={doc}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="p-1">
                  <Info size={15} />
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>The content of this document is used in your chat</p>
              </TooltipContent>
            </Tooltip>
          </DocumentItem>
        ))}
      </TooltipProvider>
    </div>
  );
};
