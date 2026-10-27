/** Product descriptions shared by public Home and both signed-in clients.
 * Examples describe requests, never live activity or guaranteed results.
 */
export const HOME_AGENT_GUIDE = [
  {
    name: "Background",
    brief: "Tasks you delegate.",
    timing: "When you delegate a task",
    summary:
      "Give it the project notes and a clear task. Come back to a draft, its sources and any questions.",
    request:
      "Read the launch notes in this project. Draft a checklist of unfinished work and link each item to its source.",
    result: "Review the draft and its sources in agent activity.",
    pause: "If it needs an answer or approval, work waits for you.",
    steps: [
      {
        title: "Choose the work",
        body: "Give it a task and the project notes it should use.",
      },
      {
        title: "Leave it to work",
        body: "Follow the task’s progress in agent activity.",
      },
      {
        title: "Review the result",
        body: "Read the draft and sources; decide what to keep.",
      },
    ],
  },
  {
    name: "Overnight",
    brief: "Queued work for tonight.",
    timing: "Inside your chosen night window",
    summary:
      "Queue work for tonight. In the morning, see what finished, what needs your decision and what is still queued.",
    request:
      "Tonight, work through the research tasks in my queue. Keep the sources and list any questions I need to answer.",
    result:
      "Review results, proposed changes and unfinished tasks in Overnight.",
    pause: "The night window and work budget limit the run.",
    steps: [
      {
        title: "Queue tonight’s tasks",
        body: "Choose the work, night window and budget.",
      },
      {
        title: "Let the night run",
        body: "Work stays within that window and stops at its limit.",
      },
      {
        title: "Review in the morning",
        body: "See results, questions and anything left unfinished in Overnight.",
      },
    ],
  },
] as const;

/** No activity should be inferred from an avatar or the time of day. */
export const HOME_AGENT_IDLE_NOTE =
  "Agents stay idle until they have authorized work. Background and Overnight have separate runs, activity and results.";
