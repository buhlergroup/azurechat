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
import { SupportedFileExtensionsInputImages, AttachedFileModel } from "../../chat-services/models";
import { chatStore } from "../../chat-store";
import { InputImageStore } from "@/features/ui/chat/chat-input-area/input-image-store";
import { AddAttachedFile, RemoveAttachedFile } from "../../chat-services/chat-thread-service";

// File extensions that should be handled by Code Interpreter instead of Azure Search
// These are data files that are better processed by Python code
const CODE_INTERPRETER_ONLY_EXTENSIONS = [
  "XLSX", "XLS",  // Excel files
  "CSV",          // CSV files  
  "JSON",         // JSON data files
  "XML",          // XML data files
  "PKL",          // Python pickle files
  "ZIP", "TAR",   // Archives
];

// File extensions that should be indexed in Azure Search for RAG
const AZURE_SEARCH_INDEXABLE_EXTENSIONS = [
  "PDF",          // PDF documents
  "TXT",          // Text files
  "DOCX", "DOC",  // Word documents
  "PPTX", "PPT",  // PowerPoint
  "HTML", "HTM",  // HTML files
  "MD",           // Markdown
];

async function shouldUseCodeInterpreter(extension: string): Promise<boolean> {
  return CODE_INTERPRETER_ONLY_EXTENSIONS.includes(extension.toUpperCase());
}

async function shouldIndexInAzureSearch(extension: string): Promise<boolean> {
  return AZURE_SEARCH_INDEXABLE_EXTENSIONS.includes(extension.toUpperCase());
}

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

      // Check if this file should go to Code Interpreter instead of Azure Search
      if (fileExtension && await shouldUseCodeInterpreter(fileExtension)) {
        this.uploadButtonLabel = "Uploading for Code Interpreter";
        
        try {
          const uploadFormData = new FormData();
          uploadFormData.append("file", file);

          const response = await fetch("/api/code-interpreter/upload", {
            method: "POST",
            body: uploadFormData
          });

          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || "Upload failed");
          }

          const data = await response.json();
          
          console.log("file-store: File uploaded, adding to chatStore:", { id: data.id, name: data.name });
          
          // Create attached file model
          const attachedFile: AttachedFileModel = {
            id: data.id,
            name: data.name,
            type: "code-interpreter",
            uploadedAt: new Date()
          };
          
          // Add file to store and enable code interpreter
          chatStore.addAttachedFile(attachedFile);
          chatStore.toggleCodeInterpreter(true);
          
          // Persist to database
          await AddAttachedFile(chatThreadId, attachedFile);
          
          console.log("file-store: After adding, attachedFiles:", chatStore.attachedFiles);

          this.uploadButtonLabel = file.name + " ready for analysis";
          showSuccess({
            title: "File uploaded",
            description: `${file.name} is ready for Code Interpreter analysis`
          });
        } catch (error) {
          showError(`Failed to upload file: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
          this.uploadButtonLabel = "";
          chatStore.updateLoading("idle");
        }
        return;
      }

      // For text documents, proceed with Azure Search indexing
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
