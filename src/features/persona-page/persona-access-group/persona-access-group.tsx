import { Label } from "@/features/ui/label";
import { FC, useState } from "react";
import { useSession } from "next-auth/react";
import { PersonaAccessGroupSelector } from "./persona-access-group-selector";
import { AccessGroup } from "../persona-services/models";

interface Props {}

export const PersonaAccessGroup: FC<Props> = (props) => {
  const { data: session } = useSession();
  const [selectedGroup, setSelectedGroup] = useState<AccessGroup | null>(null);

  return (
    <div className="grid gap-2">
      <Label>Access to Persona</Label>
      <PersonaAccessGroupSelector
        onSelectGroup={(e:any) => setSelectedGroup(e)}
        selectedAccessGroupId={selectedGroup?.id ?? ""}
      />
      <div className="flex items-center space-x-2">Selected group</div>
    </div>
  );
};
