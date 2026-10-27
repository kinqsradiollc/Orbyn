/** The planning state visible immediately after a project change. */
export type ProjectSnapshot = {
  /** PostgreSQL bigint, sent as decimal text to preserve precision. */
  event_order: string;
  created_at: string;
  project: {
    name: string;
    summary: string;
    status: string;
    deadline: string | null;
  };
  stages: { id: string; name: string; position: number }[];
  tasks: {
    id: string;
    title: string;
    status: string;
    due_at: string | null;
    progress: number;
    stage_id: string | null;
  }[];
  notes: { id: string; title: string; version: number }[];
  records: {
    id: string;
    kind: string;
    title: string;
    status: string;
    due_at: string | null;
    review_at: string | null;
  }[];
};

/** One point to return to in a project's history. */
export type ProjectCheckpoint = {
  event_order: string;
  created_at: string;
  summary: string;
  actor_name: string | null;
};
