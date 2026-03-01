"use client";

import { Star } from "lucide-react";
import { FC, useTransition } from "react";
import { Button } from "../../ui/button";
import { ToggleFavoriteAgent } from "../persona-services/agent-favorite-service";

interface Props {
  agentId: string;
  isFavorited: boolean;
  onToggle: (agentId: string) => void;
}

export const FavoriteAgentButton: FC<Props> = ({
  agentId,
  isFavorited,
  onToggle,
}) => {
  const [isPending, startTransition] = useTransition();

  const handleClick = () => {
    onToggle(agentId);
    startTransition(async () => {
      await ToggleFavoriteAgent(agentId);
    });
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={handleClick}
      disabled={isPending}
      aria-label={isFavorited ? "Remove from favorites" : "Add to favorites"}
      className="h-8 w-8"
    >
      <Star
        size={16}
        className={
          isFavorited
            ? "fill-yellow-400 text-yellow-400"
            : "text-muted-foreground"
        }
      />
    </Button>
  );
};
