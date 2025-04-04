import { Label } from "@/features/ui/label";
import { FC, useState } from "react";
import { SharePointFilePicker } from "./sharepoint-file-picker";
import { useSession } from "next-auth/react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/features/ui/tooltip";
import { Info, Trash } from "lucide-react";
import { Button } from "@/features/ui/button";
import { DocumentDetails } from "@/features/persona-page/persona-services/persona-documents-service";
import {
  DocumentMetadata,
  SharePointFile,
} from "../persona-services/models";
import { toast } from "@/features/ui/use-toast";

interface Props {
  initialPersonaDocumentIds: string[];
}

export const PersonaDocuments: FC<Props> = (props) => {
  const { data: session } = useSession();
  const [pickedFiles, setPickedFiles] = useState<DocumentMetadata[]>([]);

  const handleNewFilesSelected = async (
    pickedFiles: SharePointFile[]
  ) => {
    const response = await DocumentDetails(pickedFiles);

    if (response.status === "OK") {
      setPickedFiles(response.response);
    } else {
      toast({
        title: "Error",
        description:
          response.errors?.map((error) => error.message).join(", ") ||
          "Error fetching document details. Please try again.",
        variant: "destructive",
      });
    }
  };

  const removeDocument = (file: SharePointFile) => {
    setPickedFiles((prevFiles) => prevFiles.filter((f) => f.documentId !== file.documentId));
  };

  return (
    <div className="grid gap-2">
      <div className="flex items-center space-x-2 justify-between">
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
          onFilesSelected={async (files) => await handleNewFilesSelected(files)}
        />
      </div>
      <div className="flex items-center w-full">
        <input
          type="hidden"
          name="personaDocumentIds"
          value={pickedFiles.map((file) => file.documentId)}
        />

        {pickedFiles.length === 0 ? (
          <div className="p-2 flex items-center justify-center w-full text-muted-foreground">
            No files selected
          </div>
        ) : (
          <div className="w-full">
            {pickedFiles.map((file) => (
              <div
                key={file.documentId}
                className="flex items-center space-x-2 justify-between border rounded-md p-2 mb-2 border-input bg-background"
              >
                <div>
                  <p>{file.name}</p>
                  <div className="flex items-center space-x-2 mt-1">
                    <p className="text-sm text-muted-foreground">
                      {new Date(file.createdDateTime).toLocaleDateString(
                        "de-CH"
                      )}
                    </p>
                    <p className="px-1 text-sm text-muted-foreground">|</p>
                    <p className="text-sm text-muted-foreground">
                      {file.createdBy}
                    </p>
                  </div>
                </div>
                <Button size={"icon"} variant="ghost" type="button">
                  <Trash
                    size={15}
                    className="text-red-500"
                    onClick={() => removeDocument(file)}
                  />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
