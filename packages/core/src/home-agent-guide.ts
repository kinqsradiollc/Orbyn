/** Product descriptions shared by public Home and both signed-in clients.
 * Examples describe requests, never live activity or guaranteed results.
 */
export const HOME_AGENT_GUIDE = [
  {
    name: "Background",
    timing: "When you delegate a task",
    summary: "Give it a task. Check its progress and return to the result.",
    request: "Read these project notes and draft the next steps.",
    result: "Review the draft and its sources in agent activity.",
    pause: "If it needs an answer or approval, work waits for you.",
  },
  {
    name: "Overnight",
    timing: "Inside your chosen night window",
    summary: "Queue work for tonight. Review what happened in the morning.",
    request: "Work through the tasks I’ve queued for tonight.",
    result:
      "Review results, proposed changes and unfinished tasks in Overnight.",
    pause: "The night window and work budget limit the run.",
  },
] as const;

/** No activity should be inferred from an avatar or the time of day. */
export const HOME_AGENT_IDLE_NOTE =
  "Agents stay idle until they have authorized work. Each keeps its own runs, activity and results.";
