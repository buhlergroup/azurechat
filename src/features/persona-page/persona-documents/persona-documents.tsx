import { Label } from "@/features/ui/label";
import { FC } from "react";
import { SharePointFilePicker } from "./sharepoint-file-picker";
import { useSession } from "next-auth/react";

interface Props {}

export const PersonaDocuments: FC<Props> = (props) => {
  const { data: session } = useSession();

  return (
    <div className="grid gap-2">
      <Label>Persona Documents</Label>
      <SharePointFilePicker
        token={session?.user?.accessToken ?? ""}
        tenantUrl={process.env.NEXT_PUBLIC_SHAREPOINT_URL ?? ""}
        onFilesSelected={() => console.log("a")}
      />
      <div className="flex items-center space-x-2">files</div>
    </div>
  );
};
