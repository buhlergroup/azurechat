"use server";
import "server-only";
import { getGraphClient } from "../../common/services/microsoft-graph-client";
import { getCurrentUser } from "@/features/auth-page/helpers";
import { AccessGroup } from "@/features/persona-page/persona-services/models";

export async function UserAccessGroups(): Promise<AccessGroup[]> {
  try {
    const user = await getCurrentUser();
    let client = getGraphClient(user.token);

    const response = await client
      .api("/me/memberOf/$/microsoft.graph.group")
      .filter("groupTypes/any(c:c eq 'Unified')")
      .select("id,displayName,description")
      .get();

    const accessGroups = response.value.map((group: any) => ({
      id: group.id,
      name: group.displayName,
      description: group.description,
    })) as AccessGroup[];

    return accessGroups;
  } catch (error: unknown) {
    if (error instanceof Error) {
      throw new Error(`Failed to fetch access groups: ${error.message}`);
    } else {
      throw new Error("Failed to fetch access groups: Unknown error");
    }
  }
}
