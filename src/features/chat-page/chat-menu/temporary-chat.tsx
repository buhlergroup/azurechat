"use client";

import { TEMPORARY_CHAT_ROUTE } from "@/features/theme/theme-config";
import { Button } from "@/features/ui/button";
import { Clock } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";

export const TemporaryChat = () => {
  const router = useRouter();

  const pathname = usePathname();
  const isTemporaryChat = pathname === TEMPORARY_CHAT_ROUTE;

  return (
    <Button
      title="Temporary Chat"
      size={"default"}
      className={`flex gap-2 ${
        isTemporaryChat ? "text-primary" : ""
      }`}
      onClick={() => router.push(TEMPORARY_CHAT_ROUTE)}
      variant="outline"
    >
      <Clock size={18} />
    </Button>
  );
};
