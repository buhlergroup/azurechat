"use client";

import { useState, useEffect, useRef } from "react";
import { v4 as uuid } from "uuid";
import { Button } from "@/features/ui/button";
import { ExternalLink, XIcon } from "lucide-react";
import { toast } from "@/features/ui/use-toast";

export interface PickedFile {
  id: string;
  name: string;
  size: number;
  webUrl: string;
  "@microsoft.graph.downloadUrl"?: string;
  parentReference: {
    driveId: string;
  };
  "@sharePoint.endpoint": string;
}

interface SharePointFilePickerSelectorProps {
  tenantUrl: string;
  token: string;
  onFilesSelected: (files: PickedFile[]) => void;
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
              // Replace with toast
              console.error("Authentication error:", error);
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
            // Close the iframe picker
            setShowPicker(false);
            break;
            console.log("Picked items:", command.items);

          case "pick":
            try {
              onFilesSelected(command.items);

              // Let the picker know the pick command was handled
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
        entry: {
          sharepoint: {},
        },
        messaging: {
          origin: window.location.origin,
          channelId: channelIdRef.current,
        },
        search: { enabled: true },
        authentication: {},
        typesAndSources: {
          mode: "files",
          filters: [], // TODO: Filter for supported file types
        },
        selection: {
          mode: "multiple", // Allow multiple file selection
          enablePersistence: true,
          maximumCount: 10,
        },
        commands: {
          theme: "dark",
        },
      };

      const queryString = new URLSearchParams({
        filePicker: JSON.stringify(options),
        locale: "en-us",
      });

      const url = `${tenantUrl}/_layouts/15/FilePicker.aspx?${queryString}`;

      // We need to wait for the iframe to be in the DOM
      setTimeout(() => {
        if (iframeRef.current) {
          const iframeDoc =
            iframeRef.current.contentDocument ||
            iframeRef.current.contentWindow?.document;

          if (iframeDoc) {
            // Create a form to POST to the picker
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
      <div className="space-y-4">
        <Button
          onClick={openFilePicker}
          disabled={isLoading || !token || showPicker}
          className="w-full"
        >
          {isLoading ? "Opening File Picker..." : "Open OneDrive File Picker"}
        </Button>
      </div>

      {/* Iframe File Picker Modal */}
      {showPicker && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="relative bg-white rounded-lg w-[90vw] h-[80vh] max-w-6xl flex flex-col">
            <div className="flex items-center justify-between p-4 border-b">
              <div>
                <h2 className="text-xl font-semibold text-black">
                  Select Files
                </h2>
                <span className="inline-flex items-center gap-2">
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
                      {isLoading && ("a")}
                    </Button>
                  </a>
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowPicker(false)}
                aria-label="Close"
                className="text-black"
              >
                <XIcon className="h-5 w-5" />
              </Button>
            </div>
            <div className="flex-1 relative">
              <iframe
                ref={iframeRef}
                className="absolute inset-0 w-full h-full border-0 rounded-lg"
                title="OneDrive File Picker"
                onLoad={() => setIsLoading(false)}
                onLoadStart={() => setIsLoading(true)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
