import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "../tooltip";
import type { ReactNode } from "react";

interface ErrorComponentProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  colorClass?: string; // E.g., "text-red-500", "text-yellow-500"
  borderClass?: string; // E.g., "border-red-200"
  tooltipContent?: ReactNode;
}

export const ErrorDocumentItem = ({
  title,
  description,
  icon = <Info size={15} />,
  colorClass = "text-red-500",
  borderClass = "border-red-200",
  tooltipContent,
}: ErrorComponentProps) => (
  <div className={`flex items-center space-x-2 justify-between border rounded-md p-2 mb-2 ${borderClass} bg-background`}>
    <div>
      <p>{title}</p>
      {description && (
        <p className="text-sm text-muted-foreground mt-1">{description}</p>
      )}
    </div>
    {tooltipContent && (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={`p-1 ${colorClass}`}>
            {icon}
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p>{tooltipContent}</p>
        </TooltipContent>
      </Tooltip>
    )}
  </div>
);