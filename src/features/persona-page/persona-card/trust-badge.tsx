"use client";

import { FC } from "react";
import { BadgeCheck, Users } from "lucide-react";
import { Badge } from "../../ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../ui/tooltip";
import { TrustLevel } from "../persona-services/models";

interface TrustBadgeProps {
  level: TrustLevel;
}

const BADGE_CONTENT: Record<
  TrustLevel,
  { label: string; tooltip: string; icon: typeof BadgeCheck }
> = {
  verified: {
    label: "Verified",
    tooltip: "Reviewed and verified by the Bühler agent governance team.",
    icon: BadgeCheck,
  },
  community: {
    label: "Community",
    tooltip:
      "Published by a colleague and not yet reviewed — use your own judgment.",
    icon: Users,
  },
};

export const TrustBadge: FC<TrustBadgeProps> = ({ level }) => {
  const { label, tooltip, icon: Icon } = BADGE_CONTENT[level];
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* Neutral outline for Community so the brand color is reserved
              for Verified — the actual trust signal. tabIndex makes the
              tooltip keyboard-reachable. */}
          <Badge
            variant={level === "verified" ? "default" : "outline"}
            className={`gap-1 shrink-0 cursor-default ${
              level === "community" ? "text-muted-foreground" : ""
            }`}
            tabIndex={0}
          >
            <Icon className="h-3 w-3" />
            {label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-[240px]">
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
