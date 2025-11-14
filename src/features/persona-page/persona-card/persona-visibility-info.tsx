"use client";

import { useCallback, useState } from "react";
import { Info } from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/features/ui/tooltip";
import { PersonaModel } from "../persona-services/models";
import { AccessGroupById } from "../persona-services/access-group-service";
import { logoutOnSessionExpired } from "@/features/auth-page/logout-on-session-expired";

interface PersonaVisibilityInfoProps {
  persona: PersonaModel;
}

export const PersonaVisibilityInfo = (
  props: PersonaVisibilityInfoProps
) => {
  const { persona } = props;
  const [groupName, setGroupName] = useState<string | null>(null);
  const [isFetchingGroup, setIsFetchingGroup] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasLoadedGroup, setHasLoadedGroup] = useState(false);

  const shouldRender = Boolean(persona.isPublished || persona.accessGroup?.id);

  const fetchGroupDetails = useCallback(async () => {
    if (
      !persona.accessGroup?.id ||
      isFetchingGroup ||
      hasLoadedGroup
    ) {
      return;
    }

    setIsFetchingGroup(true);
    setLoadError(null);

    const response = await AccessGroupById(persona.accessGroup.id);

    if (logoutOnSessionExpired(response)) {
      setIsFetchingGroup(false);
      return;
    }

    if (response.status === "OK") {
      setGroupName(response.response.name);
      setHasLoadedGroup(true);
    } else {
      setLoadError("Unable to load the group name. Hover again to retry.");
    }

    setIsFetchingGroup(false);
  }, [persona.accessGroup?.id, isFetchingGroup, hasLoadedGroup]);

  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (isOpen && persona.accessGroup?.id) {
        fetchGroupDetails();
      }
    },
    [fetchGroupDetails, persona.accessGroup?.id]
  );

  if (!shouldRender) {
    return null;
  }

  const tooltipMessage = (): string => {
    if (persona.accessGroup?.id) {
      if (isFetchingGroup) {
        return "Loading the shared group name...";
      }

      if (groupName) {
        return `Shared with the "${groupName}" group you belong to.`;
      }

      if (loadError) {
        return loadError;
      }

      return "This persona is shared with one of your access groups.";
    }

    return "This persona is public, so everyone in your organization can see it.";
  };

  return (
    <TooltipProvider>
      <Tooltip onOpenChange={handleOpenChange}>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Why you can see this persona"
            className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <Info className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <p>{tooltipMessage()}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
