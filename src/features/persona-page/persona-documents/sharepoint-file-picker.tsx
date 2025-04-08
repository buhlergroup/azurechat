"use client";

import { useState, useEffect, useRef } from "react";
import { v4 as uuid } from "uuid";
import { Button } from "@/features/ui/button";
import { Edit, ExternalLink, icons, XIcon } from "lucide-react";
import { toast } from "@/features/ui/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/features/ui/dialog";
import { SharePointFile } from "../persona-services/models";
import {
  SupportedFileExtensionsDocumentIntellicence,
  SupportedFileExtensionsTextFiles,
} from "@/features/chat-page/chat-services/models";

interface SharePointFilePickerSelectorProps {
  tenantUrl: string;
  token: string;
  onFilesSelected: (files: SharePointFile[]) => void;
}

export function SharePointFilePicker({
  tenantUrl,
  token,
  onFilesSelected,
}: SharePointFilePickerSelectorProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const portRef = useRef<MessagePort | null>(null);
  const channelIdRef = useRef<string>(uuid());

  useEffect(() => {
    // Set up message listener for the picker
    const messageListener = (event: MessageEvent) => {
      // For iframe, we check if the origin matches our tenant URL
      // This is a security measure to ensure we only process messages from our iframe
      if (event.origin.includes(new URL(tenantUrl).hostname)) {
        const message = event.data;

        if (
          message.type === "initialize" &&
          message.channelId === channelIdRef.current
        ) {
          portRef.current = event.ports[0];

          portRef.current.addEventListener("message", channelMessageListener);
          portRef.current.start();

          portRef.current.postMessage({
            type: "activate",
          });
        }
      }
    };

    window.addEventListener("message", messageListener);

    return () => {
      window.removeEventListener("message", messageListener);
    };
  }, []);

  const channelMessageListener = async (message: MessageEvent) => {
    const payload = message.data;

    switch (payload.type) {
      case "notification":
        const notification = payload.data;

        if (notification.notification === "page-loaded") {
          console.log("Picker page loaded and ready");
        }

        break;

      case "command":
        // Acknowledge all commands
        portRef.current?.postMessage({
          type: "acknowledge",
          id: message.data.id,
        });

        const command = payload.data;

        switch (command.command) {
          case "authenticate":
            try {
              if (!token) {
                throw new Error("No token provided");
              }

              portRef.current?.postMessage({
                type: "result",
                id: message.data.id,
                data: {
                  result: "token",
                  token: token,
                },
              });
            } catch (error) {
              toast({
                title: "Error",
                description: "Unable to open file picker. Please try again.",
                variant: "destructive",
              });
              portRef.current?.postMessage({
                type: "result",
                id: message.data.id,
                data: {
                  result: "error",
                  error: {
                    code: "unableToObtainToken",
                    message:
                      error instanceof Error ? error.message : "Unknown error",
                  },
                },
              });
            }
            break;

          case "close":
            setShowPicker(false);
            break;

          case "pick":
            try {
              const files = command.items.map((item: any) => {
                const file: SharePointFile = {
                  documentId: item.id,
                  parentReference: {
                    driveId: item.parentReference.driveId,
                  },
                };
                return file;
              });

              onFilesSelected(files);

              portRef.current?.postMessage({
                type: "result",
                id: message.data.id,
                data: {
                  result: "success",
                },
              });

              setShowPicker(false);
            } catch (error) {
              portRef.current?.postMessage({
                type: "result",
                id: message.data.id,
                data: {
                  result: "error",
                  error: {
                    code: "unusableItem",
                    message:
                      error instanceof Error ? error.message : "Unknown error",
                  },
                },
              });
            }
            break;

          default:
            portRef.current?.postMessage({
              type: "result",
              id: message.data.id,
              data: {
                result: "error",
                error: {
                  code: "unsupportedCommand",
                  message: command.command,
                },
              },
            });
            break;
        }
        break;
    }
  };

  const openFilePicker = async () => {
    setIsLoading(true);

    try {
      setShowPicker(true);

      // Schema for the file picker options
      // https://learn.microsoft.com/en-us/onedrive/developer/controls/file-pickers/v8-schema?view=odsp-graph-online
      const options = {
        sdk: "8.0",
        entry: {},
        messaging: {
          origin: window.location.origin,
          channelId: channelIdRef.current,
        },
        search: { enabled: true },
        typesAndSources: {
          mode: "files",
          filters: [
            ...Object.values(SupportedFileExtensionsDocumentIntellicence).map(
              (ext) => `.${ext}`
            ),
            ...Object.values(SupportedFileExtensionsTextFiles).map(
              (ext) => `.${ext}`
            ),
          ],
        },
        selection: {
          mode: "multiple",
          enablePersistence: true,
          maximumCount: process.env.NEXT_PUBLIC_MAX_PERSONA_DOCUMENT_LIMIT || 20,
        },
      };

      const queryString = new URLSearchParams({
        filePicker: JSON.stringify(options),
        locale: "en-us",
      });

      const url = `${tenantUrl}_layouts/15/FilePicker.aspx?${queryString}`;

      // We need to wait for the iframe to be in the DOM
      setTimeout(() => {
        if (iframeRef.current) {
          const iframeDoc =
            iframeRef.current.contentDocument ||
            iframeRef.current.contentWindow?.document;

          if (iframeDoc) {
            const form = iframeDoc.createElement("form");
            form.setAttribute("action", url);
            form.setAttribute("method", "POST");

            // Add the token as a hidden input
            const tokenInput = iframeDoc.createElement("input");
            tokenInput.setAttribute("type", "hidden");
            tokenInput.setAttribute("name", "access_token");
            tokenInput.setAttribute("value", token);
            form.appendChild(tokenInput);

            iframeDoc.body.appendChild(form);
            form.submit();
          }
        }
      }, 100);
    } catch (error) {
      toast({
        title: "Error",
        description: "Unable to open file picker. Please try again.",
        variant: "destructive",
      });
      setShowPicker(false);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="relative">
      <Button
        size={"icon"}
        onClick={openFilePicker}
        className="p-1 cursor-pointer"
        variant={"ghost"}
        type="button"
      >
        <Edit size={15} />
      </Button>

      <Dialog open={showPicker} onOpenChange={setShowPicker}>
        <DialogContent className="w-[90vw] max-w-[1500px]">
          <DialogHeader>
            <DialogTitle className="text-xl font-semibold">
              Select Files
            </DialogTitle>
            <DialogDescription className="inline-flex items-center gap-2">
              Do not upload documents with a classification higher than B2.
              <a
                href={process.env.NEXT_PUBLIC_BUHLER_AI_RULES ?? ""}
                target="_blank"
              >
                <Button
                  variant={"link"}
                  className="gap-1 p-0 h-auto"
                  type="button"
                >
                  Bühler AI Policy <ExternalLink size={14} />
                </Button>
              </a>
              {isLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-background opacity-80 text-red-950">
                  <div className="loader">Loading...</div>
                </div>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="h-[50vh] max-h-[1000px]">
            <iframe
              ref={iframeRef}
              className="inset-0 w-full h-full border-0 rounded-lg"
              title="OneDrive File Picker"
              onLoad={() => setIsLoading(false)}
              onLoadStart={() => setIsLoading(true)}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
