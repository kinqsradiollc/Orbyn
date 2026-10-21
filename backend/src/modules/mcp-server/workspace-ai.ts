import { z } from "zod";
import { env } from "../../config/env.js";
import type { Principal } from "../../capabilities/policy.js";
import type { ToolDescription } from "../../capabilities/registry.js";
import { CapabilityError } from "../../capabilities/registry.js";
import type { LiveSettings } from "../../lib/settings.js";
import { pluginInferenceInput } from "../plugin/inference-contract.js";
import {
  enqueuePluginAi,
  readPluginAiEvents,
} from "../plugin/inference-broker.js";
import { pluginRead, pluginWrite } from "../plugin/execute.js";
import { pluginJobCursorKey } from "../plugin/job-cursor.js";

export const REQUEST_WORKSPACE_AI = "request_workspace_ai";
export const WORKSPACE_AI_STATUS = "get_workspace_ai_status";
const statusInput = z
  .object({ id: z.uuid(), cursor: z.string().min(1).max(512).optional() })
  .strict();

/** OAuth credentials only; neither portable keys nor UI opt-in enable paid calls. */
export function workspaceAiTools(principal: Principal): ToolDescription[] {
  if (principal.via !== "oauth") return [];
  return [
    ...(env.MCP_WORKSPACE_AI_ENABLED === "true"
      ? [
          {
            name: REQUEST_WORKSPACE_AI,
            title: "Request workspace AI",
            description:
              "Use the separately approved workspace provider, model and daily allowance. Requires owner permission for this connection. Never uses a personal ChatGPT plan. Use a fresh UUIDv7 operation_id. Resend the same operation_id to retrieve an existing receipt; never repeat an unknown outcome with a new ID.",
            inputSchema: {
              type: "object" as const,
              properties: {
                operation_id: { type: "string", format: "uuid" },
                prompt: { type: "string", minLength: 1, maxLength: 16000 },
              },
              required: ["operation_id", "prompt"],
              additionalProperties: false,
            },
            outputSchema: { type: "object" as const },
            annotations: {
              title: "Workspace AI",
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
        ]
      : []),
    {
      name: WORKSPACE_AI_STATUS,
      title: "Workspace AI status",
      description:
        "Read this connection's accepted AI receipt and progress. Unknown outcomes are retained and never replayed.",
      inputSchema: {
        type: "object" as const,
        properties: {
          id: { type: "string", format: "uuid" },
          cursor: { type: "string", minLength: 1, maxLength: 512 },
        },
        required: ["id"],
        additionalProperties: false,
      },
      outputSchema: { type: "object" as const },
      annotations: {
        title: "Workspace AI",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
  ];
}

export async function invokeWorkspaceAi(
  principal: Principal,
  headers: Record<string, string | string[] | undefined>,
  live: LiveSettings,
  name: string,
  args: Record<string, unknown>,
) {
  if (!workspaceAiTools(principal).some((tool) => tool.name === name))
    throw new CapabilityError(
      "FORBIDDEN",
      "Workspace AI is unavailable to this connection.",
    );
  const resources = { mcp: env.MCP_PUBLIC_URL, plugin: env.PLUGIN_PUBLIC_URL };
  if (name === REQUEST_WORKSPACE_AI) {
    if (live.maintenance.enabled)
      throw new CapabilityError("FORBIDDEN", "Workspace AI is paused.");
    const input = pluginInferenceInput.parse(args);
    return pluginWrite(principal, headers, live, resources, (db) =>
      enqueuePluginAi(
        db,
        principal,
        String(headers.authorization ?? ""),
        input,
      ),
    );
  }
  const input = statusInput.parse(args);
  const key = await pluginJobCursorKey();
  return pluginRead(principal, headers, live, resources, (db) =>
    readPluginAiEvents(
      db,
      principal,
      input.id,
      resources.mcp,
      key,
      input.cursor,
    ),
  );
}
