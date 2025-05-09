"use client";

import { useSession } from "next-auth/react";
import { FC, startTransition } from "react";
import { ServerActionResponse } from "../common/server-action-response";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { LoadingIndicator } from "../ui/loading";
import { ScrollArea } from "../ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "../ui/sheet";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import {
  AddOrUpdatePersona,
  personaStore,
  usePersonaState,
} from "./persona-store";
import { ExtensionDetail } from "../chat-page/chat-header/extension-detail";
import { ExtensionModel } from "../extensions-page/extension-services/models";
import { PersonaDocuments } from "./persona-documents/persona-documents";
import { PersonaAccessGroup } from "./persona-access-group/persona-access-group";
import { TooltipProvider } from "@radix-ui/react-tooltip";
import { useResetableActionState } from "../common/hooks/useResetableActionState";
import { AdvancedLoadingIndicator } from "../ui/advanced-loading-indicator";

interface Props {
  extensions: Array<ExtensionModel>;
}

export const AddNewPersona: FC<Props> = (props) => {
  const initialState: ServerActionResponse | undefined = undefined;

  const { isOpened, persona } = usePersonaState();

  const [state, submit, reset, isLoading] = useResetableActionState(
    AddOrUpdatePersona,
    initialState
  );

  const { data } = useSession();

  const PublicSwitch = () => {
    if (data === undefined || data === null) return null;

    if (data?.user?.isAdmin) {
      return (
        <div className="flex items-center space-x-2">
          <Switch name="isPublished" defaultChecked={persona.isPublished} />
          <Label htmlFor="description">Publish</Label>
        </div>
      );
    }
  };

  return (
    <Sheet
      open={isOpened}
      onOpenChange={(value) => {
        if (!isLoading) {
          personaStore.updateOpened(value);
          startTransition(() => {
            reset();
          });
        }
      }}
    >
      <SheetContent className="min-w-[480px] sm:w-[540px] flex flex-col">
        <SheetHeader>
          <SheetTitle>Persona</SheetTitle>
          {state && state.status === "OK" ? null : (
            <>
              {state &&
                state.errors.map((error, index) => (
                  <div key={index} className="text-red-500">
                    {error.message}
                  </div>
                ))}
            </>
          )}
        </SheetHeader>
        <TooltipProvider>
          <form action={submit} className="flex-1 flex flex-col">
            <ScrollArea
              className="flex-1 -mx-6 flex max-h-[calc(100vh-140px)]"
              type="always"
            >
              <div className="pb-6 px-6 flex gap-8 flex-col  flex-1">
                <input type="hidden" name="id" defaultValue={persona.id} />
                <div className="grid gap-2">
                  <Label>Name</Label>
                  <Input
                    type="text"
                    required
                    name="name"
                    defaultValue={persona.name}
                    placeholder="Name of your persona"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="description">Short description</Label>
                  <Textarea
                    className="min-h-[200px]"
                    required
                    defaultValue={persona.description}
                    name="description"
                    placeholder="Short description"
                  />
                </div>
                <div className="grid gap-2 flex-1 ">
                  <Label htmlFor="personaMessage">Personality</Label>
                  <Textarea
                    className="min-h-[300px]"
                    required
                    defaultValue={persona.personaMessage}
                    name="personaMessage"
                    placeholder="Personality of your persona"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="extensionIds[]">Extensions</Label>
                  <input
                    type="hidden"
                    name="extensionIds[]"
                    value={persona.extensionIds}
                  />
                  <ExtensionDetail
                    disabled={false}
                    extensions={props.extensions}
                    installedExtensionIds={
                      persona.extensionIds?.map((e) => e) || []
                    }
                    chatThreadId={persona.id}
                    parent="persona"
                  />
                </div>
                <PersonaAccessGroup
                  initialSelectedGroup={persona.accessGroup?.id || null}
                />
                <PersonaDocuments
                  initialPersonaDocumentIds={persona.personaDocumentIds || []}
                />
              </div>
            </ScrollArea>
            <SheetFooter className="py-2 flex sm:justify-between flex-row">
              <PublicSwitch /> <Submit isLoading={isLoading} />
            </SheetFooter>
          </form>
        </TooltipProvider>
      </SheetContent>
    </Sheet>
  );
};

function Submit({ isLoading }: { isLoading: boolean }) {
  return (
    <div className="flex items-center space-x-4">
      <Button disabled={isLoading} className="gap-2">
        <LoadingIndicator isLoading={isLoading} />
        Save
      </Button>
      <AdvancedLoadingIndicator
        isLoading={isLoading}
        interval={2500}
        loadingMessages={[
          "Checking Documents...",
          "Searching for Documents...",
          "Translating Documents...",
          "Indexing Documents...",
          "Almost there...",
          "Big documents take time...",
          "Just a moment...",
          "Hang tight...",
          "Processing your request...",
          "Analyzing content...",
          "Finalizing setup...",
          "Loading resources...",
          "Wrapping things up...",
          "Preparing your results...",
          "Tidying up the details...",
          "Double-checking info...",
          "Synchronizing...",
          "Fetching additional data...",
          "Reviewing documents...",
          "Securing data...",
          "Hold on, almost finished...",
          "Making progress...",
          "One last check...",
          "Taking longer than expected...",
        ]
        }
        />
    </div>
  );
}
