import { FC, use, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/features/ui/dialog";
import { Info, Search } from "lucide-react";
import { Input } from "@/features/ui/input";
import { Label } from "@/features/ui/label";
import { RadioGroup, RadioGroupItem } from "@/features/ui/radio-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/features/ui/tooltip";
import { AccessGroup } from "../persona-services/models";
import { getAccessGroups } from "@/features/common/services/access-group-service";
import { ScrollArea } from "@/features/ui/scroll-area";

interface Props {
  onSelectGroup: (group: any) => void;
  selectedAccessGroupId: string
}

type IsSelected = boolean;

type SelectedAccessGroup = AccessGroup & {
  isSelected: IsSelected;
};

export const PersonaAccessGroupSelector: FC<Props> = (props) => {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [accessGroups, setAccessGroups] = useState<SelectedAccessGroup[]>([]);
  const filteredAccessGroups = accessGroups.filter((group) =>
    group.id.toLowerCase().includes(searchQuery.toLowerCase())
  );

  useEffect(() => {
    const fetchAccessGroups = async () => {
      try {
        const groups = await getAccessGroups();

        const selectedGroups = groups.map((group) => ({
          ...group,
          isSelected: false,
        }));

        setAccessGroups(selectedGroups);
      } catch (error) {
        // Replace with toast
        console.error("Error fetching access groups:", error);
      }
    };

    fetchAccessGroups();
  }, []);

  const handleSelectGroup = (groupId: string) => {
    const selectedGroup = accessGroups.find((group) => group.id === groupId);
    if (selectedGroup) {
      props.onSelectGroup(selectedGroup);
    }
  };

  return (
    <>
      <div
        onClick={() => setOpen(true)}
        className="flex items-center space-x-2 cursor-pointer"
      >
        Open it
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-semibold">
              Access to Persona
            </DialogTitle>

            <p className="text-sm text-muted-foreground mb-4">
              Browse and select the desired access group for your persona.
            </p>
          </DialogHeader>

          <div className="py-2">
            <div className="relative mb-4 flex items-center justify-between">
              <div className="relative w-full">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder="Search..."
                  className="pl-8 pr-4"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <div className="ml-4">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="ml-2 h-4 w-4 text-muted-foreground cursor-pointer" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Search through groups from Sharepoint</p>
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>

            <ScrollArea className="h-[300px] w-full">
              <RadioGroup
                defaultValue={accessGroups.find((g) => g.id == props.selectedAccessGroupId)?.id}
                className="space-y-2"
                onValueChange={handleSelectGroup}
              >
                {filteredAccessGroups.map((group) => (
                  <label htmlFor={group.id} key={group.id}>
                    <div className="flex items-center justify-between border rounded-md p-3">
                      <div className="flex items-center space-x-2 justify-between w-full">
                        <div>
                          <Label htmlFor={group.id} className="font-medium">
                            {group.name}
                          </Label>
                          <div className="mt-2 text-muted-foreground">
                            <p>{group.description}</p>
                          </div>
                          <div className="mt-2 text-muted-foreground">
                            <p>{group.id}</p>
                          </div>
                        </div>
                        <RadioGroupItem value={group.id} id={group.id} />
                      </div>
                    </div>
                  </label>
                ))}
              </RadioGroup>
            </ScrollArea>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
