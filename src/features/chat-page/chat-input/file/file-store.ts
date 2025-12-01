"use client";

import { ServerActionResponse } from "@/features/common/server-action-response";
import {
  showError,
  showSuccess,
} from "@/features/globals/global-message-store";
import { proxy, useSnapshot } from "valtio";
import { IndexDocuments } from "../../chat-services/azure-ai-search/azure-ai-search";
import {
  CrackDocument,
  CreateChatDocument,
} from "../../chat-services/chat-document-service";
import { SupportedFileExtensionsInputImages } from "../../chat-services/models";
import { chatStore } from "../../chat-store";
import { InputImageStore } from "@/features/ui/chat/chat-input-area/input-image-store";

class FileStore {
  public uploadButtonLabel: string = "";

  public async onFileChange(props: {
    formData: FormData;
    chatThreadId: string;
  }) {
    const { formData, chatThreadId } = props;

    try {
      chatStore.updateLoading("file upload");

      formData.append("id", chatThreadId);
      const file: File | null = formData.get("file") as unknown as File;
      
      if(file.size > Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_DOCUMENT_SIZE)){
        const maxSizeMB = Math.round(Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_DOCUMENT_SIZE) / (1024 * 1024));
        showError(`File size is too large. Please upload a file less than ${maxSizeMB}MB.`);
        return;
      }

      const fileExtension = file.name.split(".").pop()?.toUpperCase();
      if (fileExtension && Object.values(SupportedFileExtensionsInputImages).includes(fileExtension as SupportedFileExtensionsInputImages)) {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => {
          if (typeof reader.result === "string") {
            InputImageStore.UpdateBase64Image(reader.result);
          }
        };
        chatStore.updateLoading("idle");
        return;
      }

      this.uploadButtonLabel = "Processing document";
      const crackingResponse = await CrackDocument(formData);
      if (crackingResponse.status === "OK") {
        let index = 0;

        const documentIndexResponses: Array<ServerActionResponse<boolean>> = [];

        for (const doc of crackingResponse.response) {
          this.uploadButtonLabel = `Indexing document ${index + 1}/${
            crackingResponse.response.length
          }`;

          // index one document at a time
          const indexResponses = await IndexDocuments(
            [doc],
            file.name,
            chatThreadId
          );

          documentIndexResponses.push(...indexResponses);
          index++;
        }

        const allDocumentsIndexed = documentIndexResponses.every(
          (r) => r.status === "OK"
        );

        if (allDocumentsIndexed) {
          // Update state
          this.uploadButtonLabel = file.name + " loaded";
          // Update history DB with doc on chat thread
          const response = await CreateChatDocument(file.name, chatThreadId);

          if (response.status === "OK") {
            showSuccess({
              title: "File upload",
              description: `${file.name} uploaded successfully.`,
            });
          } else {
            showError(response.errors.map((e) => e).join("\n"));
          }
        } else {
          const errors: Array<string> = [];

          documentIndexResponses.forEach((r) => {
            if (r.status === "ERROR") {
              errors.push(...r.errors.map((e) => e.message));
            }
          });

          showError(
            "Looks like not all documents were indexed" +
              errors.map((e) => e).join("\n")
          );
        }
      } else {
        showError(crackingResponse.errors.map((e) => e.message).join("\n"));
      }
    } catch (error) {
      showError("" + error);
    } finally {
      this.uploadButtonLabel = "";
      chatStore.updateLoading("idle");
    }
  }
}

export const fileStore = proxy(new FileStore());

export function useFileStore() {
  return useSnapshot(fileStore);
}
