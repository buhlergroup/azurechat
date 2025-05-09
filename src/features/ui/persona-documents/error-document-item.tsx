import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "../tooltip";
import type { ReactNode } from "react";

type ErrorComponentProps = {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  colorClass?: string;
  borderClass?: string;
  actionIcon?: ReactNode;
  action?: () => void;
  tooltipContent?: ReactNode;
};

export const ErrorDocumentItem = ({
  title,
  description,
  icon = <Info size={15} />,
  colorClass = "text-red-500",
  borderClass = "border-red-200",
  tooltipContent,
  action,
  actionIcon,
}: ErrorComponentProps) => (
  <div className={`flex items-center space-x-2 justify-between border rounded-md p-2 mb-2 ${borderClass} bg-background`}>
    <div>
      <p>{title}</p>
      {description && (
        <p className="text-sm text-muted-foreground mt-1">{description}</p>
      )}
    </div>
    <div className="flex items-center space-x-2">
      {tooltipContent && (
        <Tooltip disableHoverableContent={false}>
          <TooltipTrigger asChild>
            <div className={`p-1 ${colorClass} cursor-pointer`}>
              <Info size={15} />
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p>{tooltipContent}</p>
          </TooltipContent>
        </Tooltip>
      )}

      {action && (
        <button
          type="button"
          onClick={action}
          className={`p-1 ${colorClass} hover:opacity-80 transition`}
          aria-label="Action"
        >
          {actionIcon || icon}
        </button>
      )}
    </div>
  </div>
);
