import { SettingsSection } from "./SettingsSection";
import { Bot } from "lucide-react";

/** How to connect an external AI tool to this planner over MCP. */
export function McpNote() {
  const url = `${location.origin}/api/mcp`;
  return (
    <SettingsSection className="card settings-card" aria-labelledby="mcp-title">
      <h2 id="mcp-title">
        <Bot size={18} aria-hidden="true" /> Connect an AI tool (MCP)
      </h2>
      <p className="muted">
        Let an AI tool that takes a request header, such as Claude Code, Cursor
        or VS Code, search your tasks, add tasks and read your agenda. Point it
        at the address below and send a personal API key (make one above) as{" "}
        <code>Authorization: Bearer …</code>.
      </p>
      <p className="muted">
        The key reaches all your tasks, pages and calendar, so keep it private
        and delete it when you stop using the tool. It can&apos;t change your
        account, sign-in or keys. ChatGPT and claude.ai don&apos;t take keys, so
        they can&apos;t connect this way.
      </p>
      <code className="two-factor-secret">{url}</code>
    </SettingsSection>
  );
}
