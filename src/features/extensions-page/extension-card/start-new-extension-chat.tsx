"use client";

import { LoadingIndicator } from "@/features/ui/loading";
import { MessageCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { FC, useState } from "react";
import { Button } from "../../ui/button";
import { CreateChatWithExtension } from "../extension-services/extension-service";
import { ExtensionModel } from "../extension-services/models";

interface Props {
  extension: ExtensionModel;
}

export const StartNewExtensionChat: FC<Props> = (props) => {
  const { extension } = props;
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  return (
    <Button
      className="flex-1 gap-3"
      onClick={async () => {
        setIsLoading(true);
        const chat = await CreateChatWithExtension(extension.id);
        if (chat.status === "OK") {
          router.push(`/chat/${chat.response.id}`);
        } else {
          setIsLoading(false);
        }
      }}
    >
      {isLoading ? (
        <LoadingIndicator isLoading={isLoading} />
      ) : (
        <MessageCircle size={18} />
      )}
      Start chat
    </Button>
  );
};
