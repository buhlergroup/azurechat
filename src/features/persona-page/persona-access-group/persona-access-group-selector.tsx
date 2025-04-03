import { FC, use, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/features/ui/dialog";
import { Edit, Info, Search } from "lucide-react";
import { Input } from "@/features/ui/input";
import { Label } from "@/features/ui/label";
import { RadioGroup, RadioGroupItem } from "@/features/ui/radio-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/features/ui/tooltip";
import { AccessGroup } from "../persona-services/models";
import { UserAccessGroups } from "@/features/persona-page/persona-services/access-group-service";
import { ScrollArea } from "@/features/ui/scroll-area";
import { toast } from "@/features/ui/use-toast";
import { Button } from "@/features/ui/button";

interface Props {
  onSelectGroup: (group: any) => void;
  selectedAccessGroupId: string;
}

type SelectedAccessGroup = AccessGroup & {
  isSelected: boolean;
};

export const PersonaAccessGroupSelector: FC<Props> = (props) => {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [accessGroups, setAccessGroups] = useState<SelectedAccessGroup[]>([]);

  const filteredAccessGroups = accessGroups.filter((group) =>
    group.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  useEffect(() => {
    const fetchAccessGroups = async () => {
      try {
        const groups = await UserAccessGroups();

        const selectedGroups = groups.map((group) => ({
          ...group,
          isSelected: false,
        }));

        setAccessGroups(selectedGroups);
      } catch (error) {
        toast({
          title: "Error",
          description: "Error fetching access groups. Please try again later.",
          variant: "destructive",
        });
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
      <Button onClick={() => setOpen(true)} className="p-1 cursor-pointer" variant={"ghost"} type="button" size={"icon"}>
        <Edit size={15} />
      </Button>
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
              <div className="ml-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="mx-4 h-5 w-5 text-muted-foreground cursor-pointer" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Search through groups from Sharepoint</p>
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>

            <ScrollArea className="h-[300px] w-full">
              <RadioGroup
                defaultValue={
                  accessGroups.find((g) => g.id == props.selectedAccessGroupId)
                    ?.id
                }
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
