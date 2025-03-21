import { CHAT_DEFAULT_SYSTEM_PROMPT } from "@/features/theme/theme-config";
import { Button } from "@/features/ui/button";
import { Label } from "@/features/ui/label";
import { ScrollArea } from "@/features/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/features/ui/sheet";
import { Copy, VenetianMask } from "lucide-react";
import { FC } from "react";
import { ChatThreadModel } from "../chat-services/models";
import { personaStore } from "@/features/persona-page/persona-store";
import { useRouter } from "next/navigation";
import { FindChatThreadForCurrentUser } from "../chat-services/chat-thread-service";
import { showError } from "@/features/globals/global-message-store";

interface Props {
  chatThread: ChatThreadModel;
}

export const PersonaDetail: FC<Props> = (props) => {
  const persona = props.chatThread.personaMessageTitle;
  const personaMessage = props.chatThread.personaMessage;
  const router = useRouter();

  const handleDublicateCustomize = async () => {
    const chatThread = await FindChatThreadForCurrentUser(props.chatThread.id);
    if (chatThread.status !== "OK") {
      return showError("An error occurred while duplicating the persona.");
    }

    const dublicatePersona = {
      name: persona + " Copy",
      description: "Copy of " + persona,
      personaMessage: personaMessage,
      extensionIds: chatThread.response.extension,
    };

    personaStore.newPersonaAndOpen(dublicatePersona);

    router.push("/persona");
  };

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant={"outline"}
          size={"icon"}
          aria-label="Current Chat Persona Menu"
        >
          <VenetianMask size={16} />
        </Button>
      </SheetTrigger>
      <SheetContent className="min-w-[480px] sm:w-[540px] flex flex-col">
        <SheetHeader>
          <SheetTitle>Persona</SheetTitle>
        </SheetHeader>
        <ScrollArea className="flex-1 -mx-6 flex" type="always">
          <div className="pb-6 px-6 flex gap-8 flex-col  flex-1">
            <div className="grid gap-2">
              <Label>Name</Label>
              <div>{persona}</div>
            </div>

            <div className="grid gap-2 flex-1 ">
              <Label htmlFor="personaMessage">Personality</Label>
              <div className="whitespace-pre-wrap">{`${CHAT_DEFAULT_SYSTEM_PROMPT}`}</div>
              <div className="whitespace-pre-wrap">{`${personaMessage}`}</div>
            </div>
          </div>
        </ScrollArea>
        <div className="mt-auto pt-4 border-t">
          <Button
            variant="default"
            size="sm"
            onClick={() => handleDublicateCustomize()}
            className="gap-2 w-full"
          >
            <Copy size={16} />
            <p>Duplicate & Customise</p>
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
};
