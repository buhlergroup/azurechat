import { Markdown } from "@/features/ui/markdown/markdown";
import { FunctionSquare, Brain } from "lucide-react";
import React, { useState } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../ui/accordion";
import { RecursiveUI } from "../ui/recursive-ui";
import { CitationAction } from "./citation/citation-action";
import { ChatImageDisplay } from "./chat-image-display";
import { stripExtensionKeyPrefix } from "./tool-display-name";

interface MessageContentProps {
  message: {
    role: string;
    content: string;
    name: string;
    multiModalImage?: string;
    multiModalImages?: string[];
    reasoningContent?: string;
    id: string;
  };
}

const MessageContent: React.FC<MessageContentProps> = ({ message }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  if (message.role === "assistant" || message.role === "user") {
    return (
      <>
        {message.reasoningContent && message.role === "assistant" && (
          <div className="mb-4">
            <Accordion
              type="multiple"
              defaultValue={["reasoning"]}
              className="bg-background rounded-md border p-2"
            >
              <AccordionItem value="reasoning" className="">
                <AccordionTrigger className="text-sm py-1 items-center gap-2">
                  <div className="flex gap-2 items-center">
                    <Brain
                      size={18}
                      strokeWidth={1.4}
                      className="text-blue-500"
                    />
                    Reasoning output
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="text-sm text-muted-foreground bg-slate-50 dark:bg-slate-900 p-3 rounded-md">
                    <Markdown content={message.reasoningContent} onCitationClick={CitationAction} />
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        )}
        <Markdown
          content={message.content}
          onCitationClick={CitationAction}
        ></Markdown>
        {(() => {
          const images = message.multiModalImages?.length ? message.multiModalImages : message.multiModalImage ? [message.multiModalImage] : [];
          return images.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {images.map((imgUrl, imgIdx) => (
              <ChatImageDisplay 
                key={imgIdx}
                imageUrl={imgUrl} 
                alt="Chat image"
                className=""
              />
            ))}
          </div>
        ) : null;
        })()}
      </>
    );
  }

  if (message.role === "tool" || message.role === "function") {
    // message.name is persisted as the namespaced dispatch key for
    // extension tools (`${8-char-id-prefix}_${functionName}`, see
    // buildExtensionToolKey) — strip it for display only, the persisted
    // row is untouched.
    const displayName = stripExtensionKeyPrefix(message.name);
    return (
      <div className="py-3">
        <Accordion
          type="multiple"
          className="bg-background rounded-md border p-2"
        >
          <AccordionItem value="item-1" className="">
            <AccordionTrigger className="text-sm py-1 items-center gap-2">
              <div className="flex gap-2 items-center">
                <FunctionSquare
                  size={18}
                  strokeWidth={1.4}
                  className="text-muted-foreground"
                />{" "}
                Show {displayName}{" "}
                {displayName === "tool" ? "output" : "function"}
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <RecursiveUI documentField={toJson(message.content)} />
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    );
  }

  return null;
};

const toJson = (value: string) => {
  try {
    return JSON.parse(value);
  } catch (e) {
    return value;
  }
};

export default MessageContent;
