import { ExtensionModel } from "@/features/extensions-page/extension-services/models";
import { CHAT_DEFAULT_PERSONA } from "@/features/theme/theme-config";
import { VenetianMask } from "lucide-react";
import { FC } from "react";
import { ChatDocumentModel, ChatThreadModel } from "../chat-services/models";
import { chatStore, useChat } from "../chat-store";
import { DocumentDetail } from "./document-detail";
import { ExtensionDetail } from "./extension-detail";
import { ModelSelector } from "./model-selector";
import { PersonaDetail } from "./persona-detail";
import { MobileHeader } from "@/features/ui/mobile-header";
import { ChatReset } from "./chat-reset";

interface Props {
  chatThread: ChatThreadModel;
  chatDocuments: Array<ChatDocumentModel>;
  extensions: Array<ExtensionModel>;
}

export const ChatHeader: FC<Props> = (props) => {
  const chat = useChat();
  const persona =
    props.chatThread.personaMessageTitle === "" ||
    props.chatThread.personaMessageTitle === undefined
      ? CHAT_DEFAULT_PERSONA
      : props.chatThread.personaMessageTitle;

  return (
    <>
      {/* Mobile header with hamburger menu */}
      <MobileHeader>
        <div className="flex items-center min-w-0 flex-1 gap-2">
          {/* Model selector */}
          <div className="shrink-0">
            <ModelSelector
              selectedModel={chat.selectedModel}
              onModelChange={async (model) => await chatStore.updateSelectedModel(model)}
              disabled={chat.loading !== "idle"}
            />
          </div>
          
          {/* Chat thread info - can shrink */}
          <div className="flex flex-col min-w-0 flex-1">
            <span className="truncate text-sm">
              {props.chatThread.name}
            </span>
          </div>
          <ChatReset chatThreadId={props.chatThread.id} disabled={!chat.messages.length} />
          
          {/* Extension detail - always visible on mobile */}
          <ExtensionDetail
            disabled={props.chatDocuments.length !== 0}
            extensions={props.extensions}
            installedExtensionIds={props.chatThread.extension}
            chatThreadId={props.chatThread.id}
            parent={"chat"}
          />
        </div>
      </MobileHeader>

      {/* Desktop header */}
      <div className="bg-background border-b hidden md:flex items-center py-2 px-3">
        <div className="flex items-center min-w-0 w-full max-w-4xl mx-auto">
          {/* Main content area */}
          <div className="flex items-center min-w-0 flex-1 gap-2">
            {/* Model selector */}
            <div className="shrink-0">
              <ModelSelector
                selectedModel={chat.selectedModel}
                onModelChange={async (model) => await chatStore.updateSelectedModel(model)}
                disabled={chat.loading !== "idle"}
              />
            </div>
            
            {/* Chat thread info - can shrink */}
            <div className="flex flex-col min-w-0 flex-1">
              <span className="truncate text-base">
                {props.chatThread.name}
              </span>
              <span className="text-sm text-muted-foreground flex gap-1 items-center">
                <VenetianMask size={14} className="shrink-0" />
                <span className="truncate">{persona}</span>
              </span>
            </div>
            <ChatReset chatThreadId={props.chatThread.id} disabled={!chat.messages.length} />
            
            {/* Action buttons */}
            <div className="flex gap-1 shrink-0">
              {/* Hide persona and document details on smaller screens */}
              <div className="hidden lg:flex gap-1">
                <PersonaDetail chatThread={props.chatThread}/>
                <DocumentDetail chatDocuments={props.chatDocuments} />
              </div>
              {/* Extension detail - always visible */}
              <ExtensionDetail
                disabled={props.chatDocuments.length !== 0}
                extensions={props.extensions}
                installedExtensionIds={props.chatThread.extension}
                chatThreadId={props.chatThread.id}
                parent={"chat"}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
