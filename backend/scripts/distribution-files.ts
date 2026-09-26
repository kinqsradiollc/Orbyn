import { LEGAL_DEFAULTS, MCP_SERVER_NAME } from "@orbyn/core";
import { auditAnnotations, type Catalog } from "../src/capabilities/catalog.js";
import { directoryCasesMarkdown } from "./directory-cases.js";

/**
 * What the owner publishes or submits to list Orbyn where people find
 * agents (A7), generated with the catalog so it never drifts from the
 * server: the MCP Registry's server.json, the plugins for Claude Code,
 * Codex and Gemini CLI (config plus the "orbyn" skill, nothing else), and
 * the directory material (test cases, the annotations audit, the privacy
 * text). Nothing here is published by the build; distribution/README.md
 * lists the owner's steps.
 */

const ROOT = new URL("../../distribution/", import.meta.url);

/** The DNS-verified namespace for the MCP Registry (orbyn.dev, reversed). */
export const REGISTRY_NAME = `dev.orbyn/${MCP_SERVER_NAME}`;
export const REGISTRY_SCHEMA =
  "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json";

/** One line, 100 characters at most (the registry's limit). */
export const SHORT_DESCRIPTION =
  "Your Orbyn planner in AI agents: today, deadlines, planned sessions, projects and pages.";

const LONG_DESCRIPTION =
  "Orbyn is a hosted planner for students and small teams. Connect it to an AI agent to see your day, plan sessions before deadlines, find things in your pages and keep projects moving. The agent sees only what you allow, in the spaces you choose, and risky changes wait for you in Orbyn's Review inbox.";

/** 2026-09-26 → 2026.9.26: the catalog's date as a version. */
export const versionOf = (catalogVersion: string) =>
  catalogVersion
    .split("-")
    .map((n) => String(Number(n)))
    .join(".");

const json = (v: unknown) => JSON.stringify(v, null, 2);

/** The Connected agents section of the Privacy Policy, as shipped. */
export function agentsPrivacyText(): string {
  const m = /## Connected agents\n\n([\s\S]*?)\n\n## /.exec(
    LEGAL_DEFAULTS.privacy,
  );
  if (!m)
    throw new Error("The Privacy Policy has no Connected agents section.");
  return m[1].trim();
}

export function distributionFiles(
  catalog: Catalog,
  skill: string,
  url: string,
): { url: URL; text: string }[] {
  const version = versionOf(catalog.version);
  const at = (path: string) => new URL(path, ROOT);
  const mcpJson = { mcpServers: { [MCP_SERVER_NAME]: { type: "http", url } } };
  const audit = auditAnnotations();
  const flag = (b: boolean | undefined) => (b ? "yes" : "no");
  return [
    // The official MCP Registry (not published by the build).
    {
      url: at("mcp-registry/server.json"),
      text: json({
        $schema: REGISTRY_SCHEMA,
        name: REGISTRY_NAME,
        title: "Orbyn",
        description: SHORT_DESCRIPTION,
        version,
        websiteUrl: "https://orbyn.dev",
        remotes: [{ type: "streamable-http", url }],
      }),
    },
    // Claude Code: a plugin (and a one-plugin marketplace) with the MCP
    // server and the skill.
    {
      url: at("claude-code/.claude-plugin/plugin.json"),
      text: json({
        name: MCP_SERVER_NAME,
        version,
        description: SHORT_DESCRIPTION,
        author: { name: "Orbyn", url: "https://orbyn.dev" },
        homepage: "https://orbyn.dev/developers/mcp",
        keywords: ["planner", "tasks", "calendar", "study", "projects"],
      }),
    },
    {
      url: at("claude-code/.claude-plugin/marketplace.json"),
      text: json({
        name: MCP_SERVER_NAME,
        owner: { name: "Orbyn", url: "https://orbyn.dev" },
        plugins: [
          {
            name: MCP_SERVER_NAME,
            source: "./",
            description: SHORT_DESCRIPTION,
            version,
          },
        ],
      }),
    },
    { url: at("claude-code/.mcp.json"), text: json(mcpJson) },
    { url: at("claude-code/skills/orbyn/SKILL.md"), text: skill },
    // Codex: the MCP server (it signs in with `codex mcp login orbyn`) and
    // the skill.
    {
      url: at("codex/.codex-plugin/plugin.json"),
      text: json({
        name: MCP_SERVER_NAME,
        version,
        description: SHORT_DESCRIPTION,
        author: { name: "Orbyn", url: "https://orbyn.dev" },
        homepage: "https://orbyn.dev/developers/mcp",
        skills: "./skills/",
        mcpServers: "./.mcp.json",
      }),
    },
    { url: at("codex/.mcp.json"), text: json(mcpJson) },
    {
      url: at("codex/config.toml"),
      text: `# Add to ~/.codex/config.toml, then sign in: codex mcp login ${MCP_SERVER_NAME}\n[mcp_servers.${MCP_SERVER_NAME}]\nurl = "${url}"\n`,
    },
    { url: at("codex/skills/orbyn/SKILL.md"), text: skill },
    // Gemini CLI: an extension with the server (tools appear as
    // mcp_orbyn_<tool>) and the skill as its context file.
    {
      url: at("gemini/gemini-extension.json"),
      text: json({
        name: MCP_SERVER_NAME,
        version,
        description: SHORT_DESCRIPTION,
        mcpServers: { [MCP_SERVER_NAME]: { httpUrl: url } },
        contextFileName: "GEMINI.md",
      }),
    },
    {
      url: at("gemini/GEMINI.md"),
      text: skill.replace(/^---\n[\s\S]*?\n---\n+/, ""),
    },
    // The directories' material.
    { url: at("directory/test-cases.md"), text: directoryCasesMarkdown() },
    {
      url: at("directory/annotations.md"),
      text: [
        "# Tool annotations audit",
        "",
        "<!-- Generated by `npm run mcp:catalog -w backend` from the capability registry. Edit the tools, not this file. -->",
        "",
        `Every tool's hints (MCP annotations) next to what it really does. No tool reaches outside Orbyn, so \`openWorldHint\` is false everywhere; reads are \`readOnlyHint\`; every change says who decides. ${audit.every((a) => !a.issues.length) ? "No issues: CI (tests/mcp-directory.test.ts) keeps it that way." : "ISSUES FOUND: see the last column."}`,
        "",
        "| Tool | Title | Toolset | Read-only | Destructive | Idempotent | Open world | Tier | Who decides | Issues |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
        ...audit.map(
          (a) =>
            `| \`${a.name}\` | ${a.title} | ${a.toolset} | ${flag(a.annotations.readOnlyHint)} | ${flag(a.annotations.destructiveHint)} | ${flag(a.annotations.idempotentHint)} | ${flag(a.annotations.openWorldHint)} | ${a.tier} | ${a.review} | ${a.issues.join("; ") || "none"} |`,
        ),
        "",
      ].join("\n"),
    },
    {
      url: at("directory/privacy.md"),
      text: [
        "# Privacy text for the directories",
        "",
        "<!-- Generated by `npm run mcp:catalog -w backend` from packages/core/src/legal.ts. Edit the Privacy Policy there, not this file. -->",
        "",
        "Privacy Policy: https://orbyn.dev/privacy (the section below is part of it). Terms: https://orbyn.dev/terms. Security contact: https://orbyn.dev/.well-known/security.txt.",
        "",
        "## Connected agents (from the Privacy Policy)",
        "",
        agentsPrivacyText(),
        "",
        "## In short, for a listing",
        "",
        "- Orbyn is a hosted service. The agent uses its own model; Orbyn runs no AI for it and sends it only what the person allowed.",
        "- The person chooses the access (see, suggest, change), the spaces and the toolsets on Orbyn's own consent page, and can disconnect at any time.",
        "- Deleting, anything that reaches other people and anything in a space the connection may only suggest in waits for the signed-in person in Orbyn's Review inbox.",
        "- Each connection's activity is kept 180 days so the person can review and undo it; sign-ins are stored only as one-way hashes; request logs keep no IP addresses.",
        "",
        `Short description: ${SHORT_DESCRIPTION}`,
        "",
        `Long description: ${LONG_DESCRIPTION}`,
        "",
      ].join("\n"),
    },
  ];
}
