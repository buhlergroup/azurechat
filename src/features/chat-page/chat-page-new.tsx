"use client";
import { useEffect, useMemo, useRef, useState, memo } from "react";
import { useSession } from "next-auth/react";
import { chatStore, useChat } from "@/features/chat-page/chat-store";
import { Conversation, ConversationContent, ConversationScrollButton } from "@/components/ai-elements/conversation";
import BlackHolePlaceholder from "@/components/ai-elements/black-hole-placeholder";
import { Message, MessageAvatar, MessageContent } from "@/components/ai-elements/message";
import { Response } from "@/components/ai-elements/response";
import { RichResponse } from "@/components/ai-elements/rich-response";
import { Loader } from "@/components/ai-elements/loader";
import { Reasoning, ReasoningTrigger, ReasoningContent } from "@/components/ai-elements/reasoning";
import { Tool, ToolHeader, ToolContent, ToolInput, ToolOutput } from "@/components/ai-elements/tool";
import { PromptInput, PromptInputTextarea, PromptInputToolbar, PromptInputTools, PromptInputButton, PromptInputSubmit, PromptInputModelSelect, PromptInputModelSelectTrigger, PromptInputModelSelectContent, PromptInputModelSelectItem, PromptInputModelSelectValue } from "@/components/ai-elements/prompt-input";
import type { ChatDocumentModel, ChatMessageModel, ChatThreadModel } from "./chat-services/models";
import { ExtensionModel } from "../extensions-page/extension-services/models";
import { ChatHeader } from "./chat-header/chat-header";
import { useProfilePicture } from "../common/hooks/useProfilePicture";
import { File, Paperclip, Copy, Check } from "lucide-react";
import { Actions, Action } from "@/components/ai-elements/actions";
import { fileStore, useFileStore } from "./chat-input/file/file-store";
import { Button } from "@/features/ui/button";
import { Trash2 } from "lucide-react";
import { SoftDeleteChatDocumentsForCurrentUser } from "./chat-services/chat-thread-service";
import { RevalidateCache } from "@/features/common/navigation-helpers";
import { InternetSearch } from "@/features/ui/chat/chat-input-area/internet-search";
import { ReasoningEffortSelector } from "./chat-input/reasoning-effort-selector";
import { MODEL_CONFIGS } from "./chat-services/models";
import { ChatMessageAction } from "../ui/chat/chat-message-area/chat-message-action";

interface ChatPageNewProps {
  messages: Array<ChatMessageModel>;
  chatThread: ChatThreadModel;
  chatDocuments: Array<ChatDocumentModel>;
  extensions: Array<ExtensionModel>;
}

// Derive a coarse chat status for PromptInputSubmit icon mapping
// Status directly from chatStore.phase once available.

// Message list isolated to avoid re-render on every input keystroke
const ChatMessages = memo(function ChatMessages({ profilePicture }: { profilePicture?: string | null }) {
  const { messages, loading, chatThreadId } = useChat();
  const [copiedMap, setCopiedMap] = useState<Record<string, boolean>>({});
  const isActionable = (
    message: ChatMessageModel,
    messages: ChatMessageModel[]
  ) => message.role !== "user" && message !== messages[messages.length - 1];
  return (
    <Conversation>
      <ConversationContent>
        {messages.map((m, mIndex) => {
          const role = (m.role === 'user' || m.role === 'assistant' || m.role === 'system') ? m.role : 'assistant';
          const avatarSrc = role === 'user'
            ? (profilePicture || '/user-icon.png')
            : '/ai-icon.png';
          const reasoningMeta = chatStore.reasoningMeta[m.id] || { isStreaming: false } as any;
          const toolHistory = chatStore.toolCallHistory[m.id] || [];
          return (
            <div className="flex flex-col gap-4" key={m.id}>
            <Message key={m.id} from={role}>
              <div className="flex flex-col gap-0.5 w-full">
                <MessageContent>
                {m.reasoningContent && m.role === 'assistant' && (
                  <Reasoning isStreaming={reasoningMeta.isStreaming} defaultOpen>
                    <ReasoningTrigger>
                      {reasoningMeta.isStreaming ? 'Thinking...' : reasoningMeta.elapsed ? `Thought for ${reasoningMeta.elapsed}s` : 'Reasoning'}
                    </ReasoningTrigger>
                    <ReasoningContent>{m.reasoningContent}</ReasoningContent>
                  </Reasoning>
                )}
                {toolHistory.length > 0 && m.role === 'assistant' && (
                  <div className="space-y-3 mb-4">
                    {toolHistory.map((tc, i) => {
                      let parsedArgs: any = undefined;
                      try { parsedArgs = JSON.parse(tc.arguments); } catch { parsedArgs = tc.arguments; }
                      const state = tc.result ? 'output-available' : (chatStore.toolCallInProgress[m.id] === tc.name ? 'input-available' : 'input-streaming');
                      return (
                        <Tool key={i} defaultOpen={state !== 'input-streaming'}>
                          <ToolHeader type={`tool-${tc.name}`} state={state as any} />
                          <ToolContent>
                            <ToolInput input={parsedArgs} />
                            <ToolOutput output={tc.result} errorText={undefined} />
                          </ToolContent>
                        </Tool>
                      );
                    })}
                  </div>
                )}
                {m.role === 'tool' && (() => {
                  let parsed: any = null;
                  try { parsed = JSON.parse(m.content); } catch { /* ignore */ }
                  const toolName = parsed?.name || m.name || 'tool';
                  const toolArgs = parsed?.arguments ? (() => { try { return JSON.parse(parsed.arguments); } catch { return parsed.arguments; } })() : undefined;
                  const toolResult = parsed?.result;
                  return (
                    <Tool defaultOpen>
                      <ToolHeader type={toolName} state={toolResult ? 'output-available' : 'input-available'} />
                      <ToolContent>
                        {toolArgs && <ToolInput input={toolArgs} />}
                        <ToolOutput output={toolResult} errorText={undefined} />
                      </ToolContent>
                    </Tool>
                  );
                })()}
                {(m.role === 'assistant' || m.role === 'user' || m.role === 'system') && (
                  <RichResponse content={m.content} />
                )}
                </MessageContent>
                {(m.role === 'assistant' || m.role === 'user') && (
                  <div className="flex group-[.is-user]:justify-end group-[.is-assistant]:justify-start px-0.5">
                    <Actions className="opacity-0 transition group-hover:opacity-100">
                      <Action
                        aria-label="Copy message"
                        tooltip="Copy"
                        onClick={() => {
                          navigator.clipboard.writeText(m.content).then(() => {
                            setCopiedMap(prev => ({ ...prev, [m.id]: true }));
                            setTimeout(() => setCopiedMap(prev => ({ ...prev, [m.id]: false })), 1500);
                          });
                        }}
                        className="size-7"
                      >
                        {copiedMap[m.id] ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                      </Action>
                    </Actions>
                  </div>
                )}
              </div>
            </Message>
            {isActionable(
                  m as ChatMessageModel,
                  messages as ChatMessageModel[]
                ) && (
                  <span className="px-2">
                    <ChatMessageAction
                      chatThreadId={chatThreadId}
                      chatMessage={m as ChatMessageModel}
                      chatMessageIndex={mIndex}
                    />
                  </span>
                )}
            </div>
          );
        })}
        {loading === "loading" && (
          <div className="py-4 justify-self-center"><Loader /></div>
        )}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
});

export const ChatPageNew = (props: ChatPageNewProps) => {
  const { data: session } = useSession();
  const profilePicture = useProfilePicture(session?.user?.accessToken);

  useEffect(() => {
    chatStore.initChatSession({
      chatThread: props.chatThread,
      messages: props.messages,
      userName: session?.user?.name || "User",
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.chatThread.id, session?.user?.name]);

  // Separate subscriptions: messages handled in ChatMessages; here only input & control state
  const { input, chatThreadId, selectedModel, reasoningEffort, phase, loading, messages } = useChat();
  const { uploadButtonLabel } = useFileStore();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const internetSearch = useMemo(() => props.extensions.find(e => e.name === "Bing Search"), [props.extensions]);

  const handleDocumentsDeletion = async () => {
    if (props.chatDocuments.length === 0) return;
    const threadId = props.chatDocuments[0].chatThreadId;
    await SoftDeleteChatDocumentsForCurrentUser(threadId);
    RevalidateCache({ page: "chat", type: "layout" });
  };

  return (
    <main className="flex flex-1 relative flex-col px-3 gap-3">
      <ChatHeader
        chatThread={props.chatThread}
        chatDocuments={props.chatDocuments}
        extensions={props.extensions}
      />

        {messages.length === 0 && (
          <BlackHolePlaceholder input={input} />
        )}
        <ChatMessages profilePicture={profilePicture} />
  
      <div className="sticky bottom-3">
        <PromptInput
          onSubmit={(e) => {
            e.preventDefault();
            chatStore.submitChat(e);
          }}
        >
          {/* Attachments preview */}
          {props.chatDocuments.length > 0 && (
            <div className="flex flex-wrap gap-2 p-2">
              {props.chatDocuments.map((doc, i) => (
                <div key={i} className="px-2 py-1 gap-2 rounded border bg-background text-xs flex items-center h-7">
                  <File size={12} />
                  <span className="truncate max-w-[200px]">{doc.name}</span>
                </div>
              ))}
              <Button
                variant="outline"
                size="icon"
                className="h-7"
                onClick={handleDocumentsDeletion}
                type="button"
              >
                <Trash2 size={12} />
              </Button>
            </div>
          )}
          <PromptInputTextarea
            value={input}
            onChange={(e) => chatStore.updateInput(e.currentTarget.value)}
            placeholder="Type your message..."
          />
          <PromptInputToolbar>
            <PromptInputTools className="pl-2">
              {internetSearch && (
                <InternetSearch
                  extension={internetSearch}
                  threadExtensions={props.chatThread.extension || []}
                />
              )}
              <PromptInputButton
                aria-label="Upload file"
                onClick={() => fileInputRef.current?.click()}
                disabled={loading === 'file upload'}
              >
                <Paperclip className="size-4" />
                {uploadButtonLabel ? (
                  <span className="truncate max-w-[140px]">
                    {uploadButtonLabel.length > 18 ? uploadButtonLabel.slice(0, 15) + '…' : uploadButtonLabel}
                  </span>
                ) : (
                  'File'
                )}
              </PromptInputButton>
              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const fd = new FormData();
                  fd.append('file', file);
                  await fileStore.onFileChange({ formData: fd, chatThreadId });
                  // reset so same file can be selected again
                  e.target.value = '';
                }}
              />
              <ReasoningEffortSelector
                value={reasoningEffort}
                onChange={(effort) => chatStore.updateReasoningEffort(effort)}
                disabled={loading === 'loading'}
                showReasoningModelsOnly={MODEL_CONFIGS[selectedModel]?.supportsReasoning}
              />
              <PromptInputModelSelect value={selectedModel} onValueChange={(v) => chatStore.updateSelectedModel(v as any)}>
                <PromptInputModelSelectTrigger className="h-8 px-2 text-xs">
                  <PromptInputModelSelectValue placeholder="Model" />
                </PromptInputModelSelectTrigger>
                <PromptInputModelSelectContent>
                  {Object.keys(MODEL_CONFIGS).map(m => (
                    <PromptInputModelSelectItem key={m} value={m}>{m}</PromptInputModelSelectItem>
                  ))}
                </PromptInputModelSelectContent>
              </PromptInputModelSelect>
            </PromptInputTools>
            <div className="flex items-center gap-2 pr-2">
              {phase === 'streaming' ? (
                <PromptInputSubmit
                  status={phase as any}
                  aria-label="Stop generating"
                  onClick={(e) => {
                    e.preventDefault();
                    chatStore.stopGeneratingMessages();
                  }}
                />
              ) : (
                <PromptInputSubmit status={phase as any} />
              )}
            </div>
          </PromptInputToolbar>
        </PromptInput>
      </div>
    </main>
  );
};
