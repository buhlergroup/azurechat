"use client";

import { DropdownMenuItemWithIcon } from "@/features/chat-page/chat-menu/chat-menu-item";
import { RevalidateCache } from "@/features/common/navigation-helpers";
import { LoadingIndicator } from "@/features/ui/loading";
import {
  BadgeCheck,
  BadgeX,
  MoreVertical,
  Pencil,
  Store,
  Trash,
} from "lucide-react";
import { FC, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../ui/dropdown-menu";
import { effectiveTrustLevel, PersonaModel } from "../persona-services/models";
import {
  SetAgentTrustLevel,
  UnpublishAgent,
} from "../persona-services/agent-trust-service";
import { DeletePersona } from "../persona-services/persona-service";
import { personaStore } from "../persona-store";

interface Props {
  persona: PersonaModel;
  /** Owner/admin actions (edit, delete). */
  showOwnerActions?: boolean;
  /** Governance actions on published agents (verify/downgrade/unpublish). */
  isVerifier?: boolean;
}

type DropdownAction = "delete" | "verify" | "downgrade" | "unpublish";

export const PersonaCardContextMenu: FC<Props> = (props) => {
  const { persona, showOwnerActions = true, isVerifier = false } = props;
  const { isLoading, handleAction } = useDropdownAction({ persona });

  const trustLevel = effectiveTrustLevel(persona);
  const showVerifierActions = isVerifier && persona.isPublished;

  if (!showOwnerActions && !showVerifierActions) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger>
          {isLoading ? (
            <LoadingIndicator isLoading={isLoading} />
          ) : (
            <MoreVertical size={18} />
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {showOwnerActions && (
            <>
              <DropdownMenuItemWithIcon
                onClick={() => personaStore.updatePersona(persona)}
              >
                <Pencil size={18} />
                <span>Edit</span>
              </DropdownMenuItemWithIcon>
              <DropdownMenuItemWithIcon
                onClick={async () => await handleAction("delete")}
              >
                <Trash size={18} />
                <span>Delete</span>
              </DropdownMenuItemWithIcon>
            </>
          )}
          {showOwnerActions && showVerifierActions && <DropdownMenuSeparator />}
          {showVerifierActions && (
            <>
              {trustLevel === "community" ? (
                <DropdownMenuItemWithIcon
                  onClick={async () => await handleAction("verify")}
                >
                  <BadgeCheck size={18} />
                  <span>Mark as Verified</span>
                </DropdownMenuItemWithIcon>
              ) : (
                <DropdownMenuItemWithIcon
                  onClick={async () => await handleAction("downgrade")}
                >
                  <BadgeX size={18} />
                  <span>Downgrade to Community</span>
                </DropdownMenuItemWithIcon>
              )}
              <DropdownMenuItemWithIcon
                onClick={async () => await handleAction("unpublish")}
              >
                <Store size={18} />
                <span>Unpublish agent</span>
              </DropdownMenuItemWithIcon>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
};

const useDropdownAction = (props: { persona: PersonaModel }) => {
  const { persona } = props;
  const [isLoading, setIsLoading] = useState(false);

  const revalidate = () => {
    RevalidateCache({
      page: "persona",
    });
    RevalidateCache({
      page: "agent",
    });
  };

  const handleAction = async (action: DropdownAction) => {
    setIsLoading(true);
    switch (action) {
      case "delete":
        if (
          window.confirm(`Are you sure you want to delete ${persona.name}?`)
        ) {
          await DeletePersona(persona.id);
          revalidate();
        }
        break;
      case "verify":
        await SetAgentTrustLevel(persona.id, "verified");
        revalidate();
        break;
      case "downgrade":
        await SetAgentTrustLevel(persona.id, "community");
        revalidate();
        break;
      case "unpublish":
        if (
          window.confirm(
            `Unpublish ${persona.name} for the whole organization? Only the owner will still see it.`
          )
        ) {
          await UnpublishAgent(persona.id);
          revalidate();
        }
        break;
    }
    setIsLoading(false);
  };

  return {
    isLoading,
    handleAction,
  };
};
