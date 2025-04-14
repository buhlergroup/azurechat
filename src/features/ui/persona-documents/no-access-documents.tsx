import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "../tooltip";

export const NoAccessDocuments = ({
  count,
  description,
}: {
  count: number;
  description: string;
}) => (
  <div className="flex items-center space-x-2 justify-between border rounded-md p-2 mb-2 border-red-200 bg-background">
    <div>
      <p>You don&apos;t have access to {count} persona document(s)</p>
      <p className="text-sm text-muted-foreground mt-1">{description}</p>
    </div>
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="p-1 text-red-500">
          <Info size={15} />
        </div>
      </TooltipTrigger>
      <TooltipContent>
        <p>
          Your persona chat experience may suffer from the lack of documents.
        </p>
      </TooltipContent>
    </Tooltip>
  </div>
);
