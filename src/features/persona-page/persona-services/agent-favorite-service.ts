"use server";
import "server-only";

import { userHashedId } from "@/features/auth-page/helpers";
import { HistoryContainer } from "@/features/common/services/cosmos";
import { RevalidateCache } from "@/features/common/navigation-helpers";
import { ServerActionResponse } from "@/features/common/server-action-response";
import { AGENT_FAVORITE_ATTRIBUTE, AgentFavoriteModel } from "./models";

const getFavoriteDocId = (userId: string) => `AGENT_FAVORITE_${userId}`;

export const GetUserFavoriteAgents = async (): Promise<string[]> => {
  try {
    const userId = await userHashedId();
    const docId = getFavoriteDocId(userId);

    const { resource } = await HistoryContainer()
      .item(docId, userId)
      .read<AgentFavoriteModel>();

    return resource?.agentIds ?? [];
  } catch {
    return [];
  }
};

export const ToggleFavoriteAgent = async (
  agentId: string
): Promise<ServerActionResponse<string[]>> => {
  try {
    const userId = await userHashedId();
    const docId = getFavoriteDocId(userId);

    let currentFavorites: AgentFavoriteModel;

    try {
      const { resource } = await HistoryContainer()
        .item(docId, userId)
        .read<AgentFavoriteModel>();

      currentFavorites = resource ?? {
        id: docId,
        userId,
        type: AGENT_FAVORITE_ATTRIBUTE,
        agentIds: [],
      };
    } catch {
      currentFavorites = {
        id: docId,
        userId,
        type: AGENT_FAVORITE_ATTRIBUTE,
        agentIds: [],
      };
    }

    const index = currentFavorites.agentIds.indexOf(agentId);
    if (index >= 0) {
      currentFavorites.agentIds.splice(index, 1);
    } else {
      currentFavorites.agentIds.push(agentId);
    }

    await HistoryContainer().items.upsert<AgentFavoriteModel>(currentFavorites);

    RevalidateCache({ page: "persona" });
    RevalidateCache({ page: "agent" });

    return {
      status: "OK",
      response: currentFavorites.agentIds,
    };
  } catch (error) {
    return {
      status: "ERROR",
      errors: [{ message: `Error toggling favorite: ${error}` }],
    };
  }
};
