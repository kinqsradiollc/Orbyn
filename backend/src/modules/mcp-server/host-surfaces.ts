import { registry } from "../../capabilities/index.js";
import { z } from "zod";
import type { ToolResult } from "../../capabilities/execute.js";
import type { ToolDescription } from "../../capabilities/registry.js";
import { cardResources, readCard, toolUiMeta, resultUiMeta } from "./apps.js";

/** A sidebar launch returns no account content; a separate user click reads Today. */
export const PLUGIN_ENTRYPOINT = "open_orbyn";
export const PLUGIN_MARKDOWN_FILE = "open_markdown_file";
export const pluginEntrypointTool: ToolDescription & {
  _meta: Record<string, unknown>;
} = {
  name: PLUGIN_ENTRYPOINT,
  title: "Orbyn",
  description:
    "Open Orbyn's Today card. Reading the day requires a user action.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  outputSchema: {
    type: "object",
    properties: { kind: { const: "plugin_home" } },
    required: ["kind"],
  },
  annotations: {
    title: "Orbyn",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  _meta: {
    ...toolUiMeta("get_today"),
    "openai/ui": { entrypoints: [{ type: "global" }] },
  },
};

export function pluginEntrypointResult(
  args: Record<string, unknown>,
): ToolResult {
  if (Object.keys(args).length)
    throw new Error("The plugin entrypoint takes no arguments.");
  return {
    content: [{ type: "text", text: "Orbyn is ready." }],
    structuredContent: { kind: "plugin_home" },
  };
}

/** The host supplies only an opaque file handle; the backend never reads its path or contents. */
export const pluginMarkdownFileInput = z
  .object({
    file: z
      .object({
        name: z
          .string()
          .min(1)
          .max(256)
          .regex(/^[^/\\\r\n]+\.(?:md|markdown)$/i),
        resourceUri: z.string().trim().min(1).max(2048),
      })
      .strict(),
  })
  .strict();

export const pluginMarkdownFileTool: ToolDescription & {
  _meta: Record<string, unknown>;
} = {
  name: PLUGIN_MARKDOWN_FILE,
  title: "Markdown in Orbyn",
  description:
    "Open an existing host-provided Markdown file handle in Orbyn's source editor. Never invent a handle or infer filesystem access.",
  inputSchema: {
    type: "object",
    properties: {
      file: {
        type: "object",
        properties: {
          name: { type: "string" },
          resourceUri: { type: "string" },
        },
        required: ["name", "resourceUri"],
        additionalProperties: false,
      },
    },
    required: ["file"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: { kind: { const: "markdown_file" } },
    required: ["kind"],
  },
  annotations: {
    title: "Markdown in Orbyn",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  _meta: {
    ...toolUiMeta(PLUGIN_MARKDOWN_FILE),
    ui: {
      resourceUri: "ui://orbyn/markdown-file.html",
      visibility: ["model", "app"],
    },
    "openai/ui": {
      entrypoints: [{ type: "file", extensions: [".md", ".markdown"] }],
    },
  },
};

export function pluginMarkdownFileResult(): ToolResult {
  return {
    content: [{ type: "text", text: "Markdown file ready in the host." }],
    structuredContent: { kind: "markdown_file" },
  };
}

/** Portable cards remain available without host-specific entrypoints. */
export function pluginToolUiMeta(tool: string): Record<string, unknown> | null {
  if (tool === PLUGIN_ENTRYPOINT) return pluginEntrypointTool._meta;
  if (tool === PLUGIN_MARKDOWN_FILE) return pluginMarkdownFileTool._meta;
  return (
    toolUiMeta(tool) ??
    (registry.get(tool) ||
    ["request_workspace_ai", "get_workspace_ai_status"].includes(tool)
      ? resultUiMeta()
      : null)
  );
}

/** Host addresses are exact resource identifiers, never URLs fetched by the backend. */
export const pluginResourceInput = z
  .object({ uri: z.string().min(1).max(256) })
  .strict();

/** List static cards only for tools allowed by this connection and the UI opt-in. */
export function pluginResources(toolNames: string[], enabled: boolean) {
  if (!enabled) return [];
  const allowed = new Set(
    toolNames.map((name) => {
      const ui = pluginToolUiMeta(name)?.ui as
        { resourceUri?: string } | undefined;
      return ui?.resourceUri;
    }),
  );
  return cardResources().filter((resource) => allowed.has(resource.uri));
}

/** Recheck the current tool scope before returning a CSP-declared UI resource. */
export function readPluginResource(
  uri: string,
  toolNames: string[],
  enabled: boolean,
) {
  if (
    !pluginResources(toolNames, enabled).some(
      (resource) => resource.uri === uri,
    )
  )
    return null;
  return readCard(uri);
}

/** Static host entrypoints require an already granted domain tool, never step-up. */
export function hostSurfaceTools(names: string[], enabled: boolean) {
  if (!enabled) return [];
  return [
    ...(names.includes("get_today") ? [pluginEntrypointTool] : []),
    pluginMarkdownFileTool,
  ];
}
