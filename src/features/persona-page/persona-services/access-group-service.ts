"use server";
import "server-only";
import { getGraphClient } from "../../common/services/microsoft-graph-client";
import { getCurrentUser } from "@/features/auth-page/helpers";
import { AccessGroup } from "@/features/persona-page/persona-services/models";
import { ServerActionResponse } from "@/features/common/server-action-response";

export async function UserAccessGroups(): Promise<
  ServerActionResponse<AccessGroup[]>
> {
  try {
    const user = await getCurrentUser();
    const client = getGraphClient(user.token);

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

    return {
      status: "OK",
      response: accessGroups,
    };
  } catch (error: unknown) {
    if (error instanceof Error) {
      return {
        status: "ERROR",
        errors: [
          {
            message: `Failed to fetch access groups: ${error.message} Try logging in again.`,
          },
        ],
      };
    } else {
      return {
        status: "ERROR",
        errors: [
          {
            message: "Failed to fetch access groups: Unknown error",
          },
        ],
      };
    }
  }
}

export async function AccessGroupById(
  accessGroupId: string
): Promise<ServerActionResponse<AccessGroup>> {
  try {
    const user = await getCurrentUser();
    const client = getGraphClient(user.token);

    const response = await client
      .api(`/me/memberOf/`)
      .filter(`id eq '${accessGroupId}'`)
      .select("id,displayName,description")
      .get();

    const group = response.value[0];

    const accessGroup = {
      id: group.id,
      name: group.displayName,
      description: group.description,
    } as AccessGroup;

    return {
      status: "OK",
      response: accessGroup,
    };
  } catch (error) {
    return {
      status: "ERROR",
      errors: [
        {
          message: `Failed to fetch access group by ID: ${error} Try logging in again.`,
        },
      ],
    };
  }
}
