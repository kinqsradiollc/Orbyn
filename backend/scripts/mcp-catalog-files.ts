import { format, resolveConfig } from "prettier";
import { fileURLToPath } from "node:url";
import {
  INSTRUCTIONS,
  PROTOCOL_VERSIONS,
} from "../src/modules/mcp-server/server.js";
import { buildCatalog, catalogMarkdown } from "../src/capabilities/catalog.js";
import { skillMarkdown } from "../src/capabilities/guides.js";
import { PROMPTS } from "../src/capabilities/prompts.js";
import { distributionFiles } from "./distribution-files.js";

/** The address the published docs name (not this machine's MCP_PUBLIC_URL). */
const PUBLISHED_URL = "https://mcp.orbyn.dev/mcp";

/** Where the generated files live, from the repository root. */
const DOCS = new URL("../../docs/", import.meta.url);

/**
 * The generated files (the catalog, its page and the "orbyn" Agent Skill)
 * and their exact content, formatted as the repo's
 * Prettier check expects. (Kept out of src: Prettier is a development tool
 * the production image doesn't install.)
 */
export async function catalogFiles(): Promise<{ url: URL; content: string }[]> {
  const catalog = buildCatalog({
    protocol_versions: PROTOCOL_VERSIONS,
    instructions: INSTRUCTIONS,
    mcp_url: PUBLISHED_URL,
  });
  const skill = skillMarkdown(PUBLISHED_URL, PROMPTS);
  const files = [
    { url: new URL("mcp-catalog.json", DOCS), text: JSON.stringify(catalog) },
    { url: new URL("mcp.md", DOCS), text: catalogMarkdown(catalog) },
    { url: new URL("agent-skill/orbyn/SKILL.md", DOCS), text: skill },
    // What the owner submits and publishes (distribution/README.md).
    ...distributionFiles(catalog, skill, PUBLISHED_URL),
  ];
  return Promise.all(
    files.map(async (f) => {
      const filepath = fileURLToPath(f.url);
      // TOML and other files Prettier doesn't know stay as written.
      if (!/\.(json|md)$/.test(filepath))
        return { url: f.url, content: f.text };
      const options = (await resolveConfig(filepath)) ?? {};
      return {
        url: f.url,
        content: await format(f.text, { ...options, filepath }),
      };
    }),
  );
}
