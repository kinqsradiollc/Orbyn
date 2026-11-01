import { COMMANDS, SETTING_COMMANDS, type CommandDef } from "@orbyn/core";
export type CommandAction = () => unknown;
export type CommandActions = Readonly<Record<string, CommandAction>>;
export const COMMAND_PATHS: Record<string, string> = {
  Overview: "/app",
  Agenda: "/app/brief",
  "My tasks": "/app/tasks",
  Calendar: "/app/calendar",
  Projects: "/app/projects",
  Docs: "/app/docs",
  Memory: "/app/memory",
  Agent: "/app/agent-notes",
  Views: "/app/views",
  Study: "/app/study",
  Lists: "/app/lists",
  "AI assistant": "/app/assistant",
  Teams: "/app/teams",
  Booking: "/app/booking",
  Notifications: "/app/notifications",
  Review: "/app/review",
  Background: "/app/background",
  Overnight: "/app/overnight",
  Admin: "/app/admin",
  Settings: "/app/settings",
};
export function availableCommands(
  actions: CommandActions,
  isAdmin: boolean,
): CommandDef[] {
  return [...COMMANDS, ...SETTING_COMMANDS].filter(
    (command) =>
      command.on !== "phone" &&
      (command.needs !== "admin" || isAdmin) &&
      !!actions[command.id],
  );
}

/** Preserve a domain refusal as visible feedback rather than treating it as a successful navigation. */
export function runCommand(
  action: CommandAction,
  failed: (message: string) => void,
) {
  const report = (value: unknown) => {
    if (
      value &&
      typeof value === "object" &&
      "kind" in value &&
      value.kind === "refused" &&
      "reason" in value &&
      typeof value.reason === "string"
    )
      failed(value.reason);
  };
  try {
    const result = action();
    if (result instanceof Promise)
      void result.then(report, (error) =>
        failed(
          error instanceof Error
            ? error.message
            : "Couldn't complete that action.",
        ),
      );
    else report(result);
  } catch (error) {
    failed(
      error instanceof Error ? error.message : "Couldn't complete that action.",
    );
  }
}
