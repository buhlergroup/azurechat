import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/features/ui/tooltip";
import { CalendarPlus, History, UserRound } from "lucide-react";
import { FC, ReactNode } from "react";
import { PersonaModel } from "../persona-services/models";

interface Props {
  persona: PersonaModel;
}

const relativeAge = (date: Date, now = new Date()): string => {
  const elapsed = now.getTime() - date.getTime();
  const future = elapsed < 0;
  const absolute = Math.abs(elapsed);
  const units = [
    { milliseconds: 365 * 24 * 60 * 60 * 1000, suffix: "y" },
    { milliseconds: 30 * 24 * 60 * 60 * 1000, suffix: "mo" },
    { milliseconds: 24 * 60 * 60 * 1000, suffix: "d" },
    { milliseconds: 60 * 60 * 1000, suffix: "h" },
    { milliseconds: 60 * 1000, suffix: "m" },
  ];
  const unit = units.find(({ milliseconds }) => absolute >= milliseconds);

  if (!unit) {
    return "now";
  }

  const value = Math.floor(absolute / unit.milliseconds);
  return future ? `in ${value}${unit.suffix}` : `${value}${unit.suffix} ago`;
};

const fullDate = (date: Date): string =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);

const MetadataTooltip: FC<{
  label: string;
  children: ReactNode;
}> = ({ label, children }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <span
        aria-label={label}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        role="img"
        tabIndex={0}
      >
        {children}
      </span>
    </TooltipTrigger>
    <TooltipContent className="max-w-xs">
      <p className="break-words">{label}</p>
    </TooltipContent>
  </Tooltip>
);

export const PersonaCardMetadata: FC<Props> = ({ persona }) => {
  const createdAt = new Date(persona.createdAt);
  const changedAt = new Date(persona.updatedAt ?? persona.createdAt);
  const creator = persona.creatorName ?? "Unknown creator";

  return (
    <TooltipProvider>
      <div
        className="flex min-w-0 flex-wrap items-center gap-1 text-muted-foreground"
        data-testid="persona-metadata"
      >
        <MetadataTooltip label={`Creator: ${creator}`}>
          <UserRound aria-hidden="true" className="h-4 w-4" />
        </MetadataTooltip>
        <MetadataTooltip
          label={`Created: ${fullDate(createdAt)} (${relativeAge(createdAt)})`}
        >
          <CalendarPlus aria-hidden="true" className="h-4 w-4" />
        </MetadataTooltip>
        <MetadataTooltip
          label={`Last changed: ${fullDate(changedAt)} (${relativeAge(changedAt)})`}
        >
          <History aria-hidden="true" className="h-4 w-4" />
        </MetadataTooltip>
      </div>
    </TooltipProvider>
  );
};

export { relativeAge };
