import { Markdown } from "@/features/ui/markdown/markdown";
import { FunctionSquare, Brain } from "lucide-react";
import React from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../ui/accordion";
import { RecursiveUI } from "../ui/recursive-ui";
import { CitationAction } from "./citation/citation-action";

interface MessageContentProps {
  message: {
    role: string;
    content: string;
    name: string;
    multiModalImage?: string;
    reasoningContent?: string;
  };
}

const MessageContent: React.FC<MessageContentProps> = ({ message }) => {

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
        {message.multiModalImage && <img src={message.multiModalImage} />}
      </>
    );
  }

  if (message.role === "tool" || message.role === "function") {
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
                Show {message.name}{" "}
                {message.name === "tool" ? "output" : "function"}
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
