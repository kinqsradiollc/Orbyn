/** One recent idea proposed by the built-in assistant for the Review inbox. */
export type AssistantIdea = {
  id: string;
  title: string;
  summary: string;
  proposal_id: string | null;
  status: "pending" | "applied" | "declined" | "cancelled" | "expired";
  created_at: string;
};
