"use client";

import { CreateChatAndRedirect } from "../chat-services/chat-thread-service";
import { ChatContextMenu } from "./chat-context-menu";
import { NewChat } from "./new-chat";

export const ChatMenuHeader = () => {
  return (
    <div className="flex p-2 px-3 justify-between items-center border-b">
      <h2 className="text-sm font-semibold">Chat History</h2>
      
      <form action={CreateChatAndRedirect} className="flex gap-2">
        <NewChat />
        <ChatContextMenu />
      </form>
    </div>
  );
};
