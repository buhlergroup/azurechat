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
    <div className="bg-background border-b flex items-center py-2">
      <div className="container max-w-3xl flex justify-between items-center">
        <div className="flex items-center gap-4">
          <ModelSelector
            selectedModel={chat.selectedModel}
            onModelChange={async (model) => await chatStore.updateSelectedModel(model)}
            disabled={chat.loading !== "idle"}
          />
          <div className="flex flex-col">
            <span className="max-w-96 break-words">{props.chatThread.name}</span>
            <span className="text-sm text-muted-foreground flex gap-1 items-center">
              <VenetianMask size={18} />
              {persona}
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          <PersonaDetail chatThread={props.chatThread}/>
          <DocumentDetail chatDocuments={props.chatDocuments} />
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
  );
};
