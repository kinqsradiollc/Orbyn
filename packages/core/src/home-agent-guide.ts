/** Product descriptions shared by public Home and both signed-in clients.
 * Examples describe requests, never live activity or guaranteed results.
 */
export const HOME_AGENT_GUIDE = [
  {
    name: "Background",
    timing: "When you delegate a task",
    summary:
      "Turn project notes into a draft you can review while you get on with your day.",
    request:
      "Read my launch notes. Draft a checklist of what still needs doing.",
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
    timing: "Inside your chosen night window",
    summary:
      "Choose tonight’s tasks and wake up to results, open questions and work still to do.",
    request:
      "Tonight, work through the research tasks I’ve added to my night queue.",
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
  "Agents stay idle until they have authorized work. Each keeps its own runs, activity and results.";
