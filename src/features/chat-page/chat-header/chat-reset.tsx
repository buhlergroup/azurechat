"use client";

import { Button } from "@/features/ui/button";
import { RotateCcw } from "lucide-react";
import { useState } from "react";
import { ResetChatThread } from "../chat-services/chat-thread-service";
import { chatStore } from "@/features/chat-page/chat-store";
import { LoadingIndicator } from "@/features/ui/loading";
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogClose, DialogTrigger } from "@/features/ui/dialog";

export const ChatReset = ({ chatThreadId, disabled }: { chatThreadId: string; disabled?: boolean }) => {
  const [resetting, setResetting] = useState(false);
  const [open, setOpen] = useState(false);
  const handleReset = async () => {
    setResetting(true);
    const resetResponse = await ResetChatThread(chatThreadId);
    if (resetResponse.status === "OK") {
      chatStore.removeMessages();
    }
    setResetting(false);
    setOpen(false);
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          title="Reset Chat"
          disabled={disabled}
          size={"default"}
          className={`flex gap-2`}
          variant="outline"
        >
          {resetting ? <LoadingIndicator isLoading={resetting} /> : <RotateCcw size={18} />}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirm Reset</DialogTitle>
        </DialogHeader>
        <div>Are you sure you want to reset this chat?</div>
        <DialogFooter>
          <Button variant="destructive" onClick={handleReset} disabled={resetting}>
            {resetting ? <LoadingIndicator isLoading={resetting} /> : "Confirm"}
          </Button>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
