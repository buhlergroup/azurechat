import { Label } from "@/features/ui/label";
import { FC, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { PersonaAccessGroupSelector } from "./persona-access-group-selector";
import { AccessGroup } from "../persona-services/models";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/features/ui/tooltip";
import { Info, Trash } from "lucide-react";
import { Button } from "@/features/ui/button";
import { AccessGroupById } from "../persona-services/access-group-service";

interface Props {
  initialSelectedGroup: string | null;
}

export const PersonaAccessGroup: FC<Props> = (props) => {
  const [selectedGroup, setSelectedGroup] = useState<AccessGroup | null>();
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const fetchGroupDetails = async () => {
      if (!props.initialSelectedGroup) return;
      setIsLoading(true);
      const response = await AccessGroupById(props.initialSelectedGroup);
      if (response.status === "OK") {
        setSelectedGroup(response.response);
      } else {
        setSelectedGroup(null);
      }
      setIsLoading(false);
    };

    fetchGroupDetails();
  }, [props.initialSelectedGroup]);

  return (
    <div className="grid gap-2">
      <div className="flex items-center space-x-2 justify-between">
        <div className="flex items-center space-x-4">
          <Label>Access to Persona</Label>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info size={15} />
            </TooltipTrigger>
            <TooltipContent>
              <p>Defines who can view your persona</p>
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="flex items-center space-x-2">
          <Button
            variant={"ghost"}
            type="button"
            size={"icon"}
            disabled={!selectedGroup}
            onClick={() => setSelectedGroup(null)}
          >
            <Trash size={15} className="text-red-600" />
          </Button>
          <PersonaAccessGroupSelector
            onSelectGroup={(e: any) => setSelectedGroup(e)}
            selectedAccessGroupId={selectedGroup?.id ?? ""}
          />
        </div>
      </div>
      <div className="flex items-center space-x-2">
        <div className="border border-input bg-background rounded-md p-2 flex items-center w-full">
          {isLoading ? (
            <div className="animate-pulse w-full h-4 bg-muted rounded-md" />
          ) : selectedGroup ? (
            <input
              value={selectedGroup.name}
              readOnly
              className="w-full bg-transparent"
              disabled
            />
          ) : (
            <input
              value="Everyone can view this persona"
              readOnly
              className="w-full bg-transparent text-muted-foreground"
              disabled
            />
          )}
          {/* Bc disabled input fields won't be recognised in a form. */}
          <input
            name="accessGroupId"
            value={selectedGroup?.id ?? ""}
            type="hidden"
          />
        </div>
      </div>
    </div>
  );
};
