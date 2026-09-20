import { Bot } from "lucide-react";

/** How to connect an external AI tool to this planner over MCP. */
export function McpNote() {
  const url = `${location.origin}/api/mcp`;
  return (
    <section className="card settings-card" aria-labelledby="mcp-title">
      <h2 id="mcp-title">
        <Bot size={18} aria-hidden="true" /> Connect an AI assistant (MCP)
      </h2>
      <p className="muted">
        Let your own AI tools — Claude, Cursor, ChatGPT — search and add to your
        planner. Point an MCP client at the address below and sign it in with a
        personal API key (create one above). It can do only what that key can.
      </p>
      <code className="two-factor-secret">{url}</code>
    </section>
  );
}
