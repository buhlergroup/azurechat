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

interface Props {
  chatThread: ChatThreadModel;
}

export const PersonaDetail: FC<Props> = (props) => {
  const [documents, setDocuments] = useState<DocumentMetadata[]>([]);
  const [noAccessDocuments, setNoAccessDocuments] = useState<any>([]);

  const persona = props.chatThread.personaMessageTitle;
  const personaMessage = props.chatThread.personaMessage;
  const router = useRouter();

  useEffect(() => {
    const fetchAllDocuments = async () => {
      const personaDocuments = await fetchPersonaDocuments(
        props.chatThread.personaDocumentIds
      );
      await fetchMetadataForDocuments(personaDocuments);
    };
    fetchAllDocuments();
  }, [props.chatThread.personaDocumentIds]);

  const fetchPersonaDocuments = async (
    documentIds: string[]
  ): Promise<SharePointFile[]> => {
    if (!documentIds || documentIds.length === 0) return [];

    try {
      const responses = await Promise.all(
        documentIds.map((id) => PersonaDocumentById(id))
      );

      return responses.map((response, index) => {
        if (response.status === "OK") {
          return convertPersonaDocumentToSharePointDocument(response.response);
        } else {
          handleErrors(
            response.errors,
            `Error fetching document details for ID: ${documentIds[index]}. Please try again.`
          );
          return null;
        }
      }) as SharePointFile[];
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
    if (!documents || documents.length === 0) return;

    const response = await DocumentDetails(documents);
    if (response.status === "OK") {
      const updatedFiles = documents.map((file) => {
        const matchingDocument = response.response.successful.find(
          (doc) => doc.documentId === file.documentId
        );
        return matchingDocument ? { ...matchingDocument, id: file.id } : null;
      });

      setNoAccessDocuments(response.response.unsuccessful.map((doc) => ({})));
      setDocuments(updatedFiles as DocumentMetadata[]);

      if (response.response.unsuccessful.length > 0) {
        toast({
          title: "Some documents are not accessible",
          description:
            "Your persona chat experience may suffer from the lack of documents.",
          variant: "default",
        });
      }
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

  const handleDublicateCustomize = async () => {
    const chatThread = await FindChatThreadForCurrentUser(props.chatThread.id);
    if (chatThread.status !== "OK") {
      return showError("An error occurred while duplicating the persona.");
    }

    const dublicatePersona = {
      name: persona + " Copy",
      description: "Copy of " + persona,
      personaMessage: personaMessage,
      extensionIds: chatThread.response.extension,
    };

    // TODO: Copy also files
    personaStore.newPersonaAndOpen(dublicatePersona);

    router.push("/persona");
  };

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant={"outline"}
          size={"icon"}
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
          <div className="pb-6 px-6 flex gap-8 flex-col  flex-1">
            <div className="grid gap-2">
              <Label>Name</Label>
              <div>{persona}</div>
            </div>

            <div className="grid gap-2 flex-1 ">
              <Label htmlFor="personaMessage">Personality</Label>
              <div className="whitespace-pre-wrap">{`${CHAT_DEFAULT_SYSTEM_PROMPT}`}</div>
              <div className="whitespace-pre-wrap">{`${personaMessage}`}</div>
            </div>
            <div className="grid gap-2 flex-1 ">
              <Label htmlFor="personaMessage">Persona Documents</Label>
              <TooltipProvider>
                {noAccessDocuments.length > 0 && (
                  <div className="flex items-center space-x-2 justify-between border rounded-md p-2 mb-2 border-input bg-background">
                    <div>
                      <p>
                        You don't have access to {noAccessDocuments.length}{" "}
                        persona documents
                      </p>
                      <div className="flex items-center space-x-2 mt-1">
                        <p className="text-sm text-muted-foreground">
                          Ask the persona owner to share the documents with you
                        </p>
                      </div>
                    </div>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="p-1">
                          <Info size={15} />
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>
                          Your persona chat experience may suffer from the lack
                          of documents
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                )}
                {documents.length === 0 && (
                  <div className="p-2 flex items-center justify-center w-full text-muted-foreground">
                    No files selected
                  </div>
                )}
                {documents.map((document) => (
                  <div
                    key={document.documentId}
                    className="flex items-center space-x-2 justify-between border rounded-md p-2 mb-2 border-input bg-background"
                  >
                    <div>
                      <p>{document.name}</p>
                      <div className="flex items-center space-x-2 mt-1">
                        <p className="text-sm text-muted-foreground">
                          {new Date(
                            document.createdDateTime
                          ).toLocaleDateString("de-CH")}
                        </p>
                        <p className="px-1 text-sm text-muted-foreground">|</p>
                        <p className="text-sm text-muted-foreground">
                          {document.createdBy}
                        </p>
                      </div>
                    </div>
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
                  </div>
                ))}
              </TooltipProvider>
            </div>
          </div>
        </ScrollArea>
        <div className="mt-auto pt-4 border-t">
          <Button
            variant="default"
            size="sm"
            onClick={() => handleDublicateCustomize()}
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
