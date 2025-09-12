"use client";

import { Button } from "@/features/ui/button";
import { RotateCcw } from "lucide-react";
import { useState } from "react";
import { ResetChatThread } from "../chat-services/chat-thread-service";
import { chatStore } from "@/features/chat-page/chat-store";
import { LoadingIndicator } from "@/features/ui/loading";

export const ChatReset = ({ chatThreadId, disabled }: { chatThreadId: string; disabled?: boolean }) => {
  const [resetting, setResetting] = useState(false);
const handleReset = async () => {
    setResetting(true);
    const resetResponse = await ResetChatThread(chatThreadId);
    if (resetResponse.status === "OK") {
      chatStore.removeMessages();
    }
    setResetting(false);
  };
  return (
    <Button
      title="Reset Chat"
      disabled={disabled}
      size={"default"}
      className={`flex gap-2`}
      variant="outline"
      onClick={() => handleReset()}
    >
      {resetting ? <LoadingIndicator isLoading={resetting} /> : <RotateCcw size={18} />}
    </Button>
  );
};
