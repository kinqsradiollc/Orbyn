import type { Plan } from "@orbyn/core";

/**
 * A plan as Markdown for the chat: a table of days, times and tasks in the
 * user's time zone, then what couldn't be placed. Written by code, not the
 * model, so every time shown is exactly what applying the plan will add.
 */
export function planMarkdown(plan: Plan, timeZone: string) {
  const day = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const cell = (text: string) => text.replace(/\|/g, "/").replace(/\s+/g, " ");
  const lines: string[] = [];
  if (plan.blocks.length) {
    lines.push("| Day | Time | Task |", "| --- | --- | --- |");
    for (const b of plan.blocks) {
      const start = new Date(b.start_at);
      const end = new Date(b.end_at);
      const task =
        b.parts > 1 ? `${b.title} (${b.part} of ${b.parts})` : b.title;
      lines.push(
        `| ${day.format(start)} | ${time.format(start)}–${time.format(end)} | ${cell(task)} |`,
      );
    }
    lines.push("");
  }
  lines.push(plan.summary);
  const notes = [
    ...plan.unplaced.map((u) => `- **${cell(u.title)}**: ${u.reason}`),
    ...plan.at_risk
      .filter((r) => !plan.unplaced.some((u) => u.item_id === r.item_id))
      .map((r) => `- **${cell(r.title)}**: ${r.reason}`),
  ];
  if (notes.length) lines.push("", ...notes);
  if (plan.blocks.length)
    lines.push(
      "",
      "Review the plan and tap **Apply plan** to add these sessions to your calendar.",
    );
  return lines.join("\n");
}
