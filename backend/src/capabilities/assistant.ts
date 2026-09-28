/**
 * Short, model-facing descriptions tuned for Orbyn's built-in lead and
 * specialist loops. Input and output schemas always come from the MCP
 * capability registry; this file deliberately contains text only.
 */
export const ASSISTANT_TOOL_DESCRIPTIONS: Readonly<Record<string, string>> = {
  search:
    "Search the workspace you can reach by words. Use this to find a task, page, project or other item by name before fetching its details.",
  fetch:
    "Read one item, page, project or other resource by its typed id. Use ids returned by search or another capability, and read before suggesting a change.",
  query:
    "Find workspace rows with filters when a text search is too broad. Keep the query within your granted spaces and exclude projects kept out of AI.",
  get_context:
    "Call at the start of a run. It gives the person's agent name and persona, local time, reach, limits, instructions, standing rules, recent changes, and the Memory topic index when Personal is available.",
};
