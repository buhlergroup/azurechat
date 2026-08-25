import "server-only";

import type { Tool } from "@ai-sdk/provider-utils";
import { logInfo, logError } from "@/features/common/services/logger";
import { searchDocumentsTool } from "./search-documents";
import { searchCompanyContentTool } from "./search-company-content";
import { callSubAgentTool } from "./call-sub-agent";
import { searchSubAgentTool } from "./search-sub-agent";
import { getCurrentTimeTool } from "./get-current-time";
import { extensionTool } from "./extension-tool";
import type { ToolContext } from "./tool-context";

/**
 * Provider tool-name cap (OpenAI/Azure/Anthropic all reject function names
 * longer than this).
 */
const MAX_TOOL_NAME_LENGTH = 64;

/**
 * Namespaces an extension function's tool key with a short prefix of the
 * owning extension's id.
 *
 * Prod has 82 extensions of which 43 all share `functionName: "aisearch"`.
 * Keying the toolset purely by `parsedFunction.name` (pre-fix behavior)
 * meant every extension after the first with a given name silently
 * overwrote the previous one in the `Record<string, Tool>` — the model
 * only ever saw one "aisearch" tool, wired to whichever extension's
 * function happened to be inserted last.
 *
 * The prefix is the first 8 characters of the extension id rather than
 * the full id to avoid wasting tokens on the wire; ids are 36-char
 * nanoids drawn from a 62-character alphanumeric alphabet
 * (`features/common/util.ts` `uniqueId`), so an 8-char prefix already
 * carries ~2.2e14 possible values — a same-prefix collision between the
 * handful of extensions configured on one thread is negligible, and the
 * prefix itself is already alphanumeric so it never needs sanitizing.
 *
 * `functionName` is externally authored (extension config), so it is
 * defensively sanitized to the character set every provider accepts
 * (alphanumeric/underscore/hyphen) and the combined key is truncated to
 * MAX_TOOL_NAME_LENGTH so it always stays a valid tool identifier.
 */
export function buildExtensionToolKey(
  extensionId: string,
  functionName: string
): string {
  const prefix = extensionId.slice(0, 8);
  const safeName = functionName.replace(/[^a-zA-Z0-9_-]/g, "_");
  const key = `${prefix}_${safeName}`;
  return key.length > MAX_TOOL_NAME_LENGTH
    ? key.slice(0, MAX_TOOL_NAME_LENGTH)
    : key;
}

/**
 * Builds the toolset for a given ToolContext.
 *
 * Keys are inserted in localeCompare ascending order so that the wire
 * representation is byte-identical across requests — this is the
 * prompt-cache stability invariant locked by the snapshot test in task 3.
 *
 * Never modifies function-registry.ts; runs in parallel with the old
 * dispatcher until task-12 cutover.
 */
export async function buildToolset(
  ctx: ToolContext
): Promise<Record<string, Tool>> {
  const entries: [string, Tool][] = [];

  // RAG search — include when the thread or persona has documents
  const hasDocuments =
    (ctx.threadDocumentIds?.length ?? 0) > 0 ||
    (ctx.personaDocumentIds?.length ?? 0) > 0;

  if (hasDocuments) {
    entries.push(["search_documents", searchDocumentsTool(ctx)]);
  }

  // Company content — controlled by defaultTools toggle
  if (ctx.defaultTools?.companyContent) {
    entries.push(["search_company_content", searchCompanyContentTool(ctx)]);
  }

  // Current time — always available. Lets the model fetch the user's local
  // datetime on demand instead of baking it into the (cache-sensitive) prompt.
  entries.push(["get_current_time", getCurrentTimeTool(ctx)]);

  // Sub-agent tools are always available (subject to the recursion
  // guard). There is no "fixed assignment" — any persona the user has
  // access to can be called as a sub-agent. `search_sub_agent` lets
  // the model discover candidates via `FindAllPersonaForCurrentUser`;
  // `call_sub_agent` resolves the chosen id via `FindPersonaByID`,
  // which enforces access control. Hiding the tools when the thread
  // doesn't pre-declare `subAgentIds` was a #37 regression — it
  // prevented discovery entirely. The #37 root cause was a test-fake
  // race (inline-emitted tool result fighting a local `execute`); in
  // production these are pure custom tools owned only by us.
  const includeSubAgentTools = (ctx.depth ?? 0) < 2;

  if (includeSubAgentTools) {
    entries.push(["call_sub_agent", callSubAgentTool(ctx)]);
    entries.push(["search_sub_agent", searchSubAgentTool(ctx)]);
  }

  // Dynamic extension tools — keyed by `${extensionId prefix}_${functionName}`
  // (see buildExtensionToolKey) so extensions sharing a functionName don't
  // overwrite each other's toolset entry.
  const usedExtensionKeys = new Set<string>();
  for (const { extension, headerSecrets } of ctx.extensions ?? []) {
    for (const functionDef of extension.functions) {
      try {
        const parsedFunction = JSON.parse(functionDef.code) as {
          name: string;
          description: string;
          parameters: any;
        };
        const key = buildExtensionToolKey(extension.id, parsedFunction.name);
        if (usedExtensionKeys.has(key)) {
          // Only reachable if two extensions share both the same 8-char id
          // prefix AND the same function name (negligible per the id-space
          // argument above), or one extension defines the same function
          // name twice. Either way, keep the first registration
          // deterministically instead of silently overwriting it.
          logError("buildToolset: duplicate extension tool key, keeping first registration", {
            key,
            extensionId: extension.id,
            functionName: parsedFunction.name,
          });
          continue;
        }
        usedExtensionKeys.add(key);
        const t = extensionTool(functionDef, parsedFunction, {
          extension,
          headerSecrets,
        });
        entries.push([key, t]);
      } catch (error) {
        logError("buildToolset: failed to parse extension function", {
          extensionId: extension.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  // Sort by localeCompare for prompt-cache stability
  entries.sort(([a], [b]) => a.localeCompare(b));

  const toolset: Record<string, Tool> = {};
  for (const [name, t] of entries) {
    toolset[name] = t;
  }

  logInfo("buildToolset: built", {
    keys: Object.keys(toolset),
    depth: ctx.depth ?? 0,
  });

  return toolset;
}
