/** Distinct recipients for portable MCP and the plugin integration service. */
export type ConnectorResourceKind = "mcp" | "plugin";
export type ConnectorResources = { mcp: string; plugin?: string };
export type ConnectorResource = {
  kind: ConnectorResourceKind;
  resource: string;
};

/** Static diagnostics never reflect an untrusted resource URL or credentials. */
export class ResourceTargetError extends Error {
  constructor() {
    super(
      "The requested resource is not enabled or does not match this authorization.",
    );
  }
}

function canonical(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ResourceTargetError();
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && local)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new ResourceTargetError();
  return url.href.replace(/\/$/, "");
}

/** Resolve a configured service recipient; an empty plugin value disables it. */
export function connectorResources(
  config: ConnectorResources,
): ConnectorResource[] {
  const mcp = canonical(config.mcp);
  const result: ConnectorResource[] = [{ kind: "mcp", resource: mcp }];
  if (config.plugin) {
    const plugin = canonical(config.plugin);
    const mcpUrl = new URL(mcp);
    // MCP's historical origin alias must never become a plugin recipient.
    if (
      plugin === mcp ||
      (mcpUrl.pathname === "/mcp" && plugin === mcpUrl.origin)
    )
      throw new ResourceTargetError();
    result.push({ kind: "plugin", resource: plugin });
  }
  return result;
}

/** Preserve a code/refresh token's recipient, including when resource is omitted. */
export function selectConnectorResource(
  requested: string | undefined,
  config: ConnectorResources,
  bound?: string,
): ConnectorResource {
  const resources = connectorResources(config);
  const binding = bound
    ? resources.find((item) => item.resource === canonical(bound))
    : undefined;
  if (bound && !binding) throw new ResourceTargetError();
  if (!requested) return binding ?? resources[0];
  const given = canonical(requested);
  const selected = resources.find((item) => {
    if (item.resource === given) return true;
    const url = new URL(item.resource);
    return (
      item.kind === "mcp" && url.pathname === "/mcp" && given === url.origin
    );
  });
  if (!selected || (binding && binding.resource !== selected.resource))
    throw new ResourceTargetError();
  return selected;
}
