import { ResetChatThread } from "@/features/chat-page/chat-services/chat-thread-service";
import { ChatMessageModel } from "@/features/chat-page/chat-services/models";
import { chatStore } from "@/features/chat-page/chat-store";
import { Bookmark, Check, X } from "lucide-react";
import { useState } from "react";
import { ConfirmAction } from "../../confirm-action";

export const ChatMessageAction = ({
  chatThreadId,
  chatMessage,
}: {
  chatThreadId: string;
  chatMessage: ChatMessageModel;
}) => {
  const [restoring, setRestoring] = useState(false);

  const handleRestore = async () => {
    setRestoring(true);
    const resetResponse = await ResetChatThread(chatThreadId, {
      toMessageId: chatMessage.id,
    });
    if (resetResponse.status === "OK") {
      chatStore.removeMessagesAfter(chatMessage.id);
    }
    setRestoring(false);
  };

  return (
    <div className="relative flex items-center w-full h-[40px] group gap-1">
      <span
        className="absolute left-0 right-0"
        style={{
          top: "50%",
          transform: "translateY(-50%)",
          zIndex: -1,
        }}
      >
        <span className="block h-[1px] border-b border-dashed border-b-gray w-full" />
      </span>
      <Bookmark size={16} color="gray" className="self-center mr-2" />
      <ConfirmAction
        label="Restore"
        icon={undefined}
        confirmIcon={<Check size={18} color="green" />}
        cancelIcon={<X size={18} color="gray" />}
        onConfirm={
          restoring
            ? () => {}
            : () => {
                handleRestore();
              }
        }
        loading={restoring}
      />
    </div>
  );
};
