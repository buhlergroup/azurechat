"use client";

import { TEMPORARY_CHAT_ROUTE } from "@/features/theme/theme-config";
import { Button } from "@/features/ui/button";
import { RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";

export const ResetChat = ({ disabled }: { disabled?: boolean }) => {
  const router = useRouter();

  return (
    <Button
      title="Reset Chat"
      disabled={disabled}
      size={"default"}
      className={`flex gap-2`}
      variant="outline"
      onClick={() => router.push(TEMPORARY_CHAT_ROUTE)}
    >
      <RotateCcw size={18} />
    </Button>
  );
};
