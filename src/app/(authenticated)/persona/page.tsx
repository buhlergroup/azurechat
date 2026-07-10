import { userHashedId } from "@/features/auth-page/helpers";
import { GetAllAgentStats } from "@/features/common/services/agent-stats-service";
import { FindAllExtensionForCurrentUser } from "@/features/extensions-page/extension-services/extension-service";
import { ChatPersonaPage } from "@/features/persona-page/persona-page";
import { GetUserFavoriteAgents } from "@/features/persona-page/persona-services/agent-favorite-service";
import { IsAgentVerifier } from "@/features/persona-page/persona-services/agent-trust-service";
import { FindAllPersonaForCurrentUser } from "@/features/persona-page/persona-services/persona-service";
import { DisplayError } from "@/features/ui/error/display-error";

export default async function Home() {
  const [
    personasResponse,
    extensionsResponse,
    favoriteIds,
    currentUserId,
    agentStats,
    isVerifier,
  ] = await Promise.all([
    FindAllPersonaForCurrentUser(),
    FindAllExtensionForCurrentUser(),
    GetUserFavoriteAgents(),
    userHashedId(),
    GetAllAgentStats(),
    IsAgentVerifier(),
  ]);
  if (personasResponse.status !== "OK") {
    return <DisplayError errors={personasResponse.errors} />;
  }
  if (extensionsResponse.status !== "OK") {
    return <DisplayError errors={extensionsResponse.errors} />;
  }
  return (
    <ChatPersonaPage
      personas={personasResponse.response}
      extensions={extensionsResponse.response}
      initialFavoriteIds={favoriteIds}
      currentUserId={currentUserId}
      agentStats={agentStats}
      isVerifier={isVerifier}
    />
  );
}
