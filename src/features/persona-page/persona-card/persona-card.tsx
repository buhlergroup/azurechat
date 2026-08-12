import {
  AgentStatsModel,
  formatCount,
} from "@/features/common/services/agent-stats-models";
import { FC } from "react";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../../ui/card";
import { effectiveTrustLevel, PersonaModel } from "../persona-services/models";
import { PersonaCardContextMenu } from "./persona-card-context-menu";
import { TrustBadge } from "./trust-badge";
import { ViewPersona } from "./persona-view";
import { StartNewPersonaChat } from "./start-new-persona-chat";
import { CopyAgentLinksMenu } from "./copy-agent-links-menu";
import { PersonaVisibilityInfo } from "./persona-visibility-info";
import { FavoriteAgentButton } from "./favorite-agent-button";
import { PersonaCardMetadata } from "./persona-card-metadata";

interface Props {
  persona: PersonaModel;
  showContextMenu: boolean;
  showActionMenu: boolean;
  isFavorited?: boolean;
  onToggleFavorite?: (agentId: string) => void;
  /** Current user may verify/downgrade/unpublish published agents. */
  isVerifier?: boolean;
  /** Global usage counters for this agent, when available. */
  stats?: AgentStatsModel;
}

export const PersonaCard: FC<Props> = (props) => {
  const { persona, stats } = props;

  const trustLevel = effectiveTrustLevel(persona);
  const showVerifierActions = Boolean(
    props.isVerifier && persona.isPublished
  );

  return (
    <Card
      key={persona.id}
      data-persona-id={persona.id}
      className="flex min-w-0 flex-col overflow-hidden"
    >
      <CardHeader className="flex flex-row gap-2 items-start">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <CardTitle className="min-w-0 flex-1 line-clamp-1">
            {persona.name}
          </CardTitle>
          <PersonaVisibilityInfo persona={persona} />
          {props.onToggleFavorite && (
            <FavoriteAgentButton
              agentId={persona.id}
              isFavorited={props.isFavorited ?? false}
              onToggle={props.onToggleFavorite}
            />
          )}
        </div>
        {(props.showActionMenu || showVerifierActions) && (
          <div className="shrink-0">
            <PersonaCardContextMenu
              persona={persona}
              showOwnerActions={props.showActionMenu}
              isVerifier={props.isVerifier}
            />
          </div>
        )}
      </CardHeader>
      {/* line-clamp on an inner element: clamping the padded CardContent
          itself lets a clipped extra line bleed into its bottom padding.
          The badge/stats band always renders (min-h) so descriptions align
          across a card grid row. Stats sit on their own line below the
          badge — sharing a row clips them on narrow cards. */}
      <CardContent className="text-muted-foreground flex-1">
        <div className="flex flex-col items-start gap-1 mb-2 min-h-6">
          {trustLevel && <TrustBadge level={trustLevel} />}
          {stats && (
            <span className="text-xs">
              {formatCount(stats.chatCount)}{" "}
              {stats.chatCount === 1 ? "chat" : "chats"} ·{" "}
              {formatCount(stats.messageCount)}{" "}
              {stats.messageCount === 1 ? "msg" : "msgs"} ·{" "}
              {formatCount(stats.totalInputTokens + stats.totalOutputTokens)}{" "}
              tokens
            </span>
          )}
        </div>
        <p className="line-clamp-3">{persona.description}</p>
        <div className="mt-3">
          <PersonaCardMetadata persona={persona} />
        </div>
      </CardContent>
      <CardFooter className="gap-1 content-stretch f">
        {props.showContextMenu && <ViewPersona persona={persona} />}
        <StartNewPersonaChat persona={persona} />
        <CopyAgentLinksMenu personaId={persona.id} />
      </CardFooter>
    </Card>
  );
};
