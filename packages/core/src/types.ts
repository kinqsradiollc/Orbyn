import type { z } from "zod";
import type {
  actionSchema,
  agentReply,
  credentials,
  itemData,
  KINDS,
  PRIORITIES,
  STATUSES,
} from "./schemas.js";

export type Kind = (typeof KINDS)[number];
export type Status = (typeof STATUSES)[number];
export type Priority = (typeof PRIORITIES)[number];

/** Fields a client sends when creating or updating an item. */
export type ItemInput = z.output<typeof itemData>;
export type Credentials = z.input<typeof credentials>;
export type Action = z.output<typeof actionSchema>;
export type AgentReply = z.output<typeof agentReply>;

export type Item = ItemInput & {
  id: string;
  version: number;
  created_at?: string;
  updated_at?: string;
};

export type User = {
  id: string;
  name: string;
  email: string;
  email_reminders: boolean;
};

export type AuthResponse = { token: string; user: User };

export type Notice = {
  id: string;
  title: string;
  body: string;
  read: boolean;
  created_at: string;
};

/** An AI plan awaiting user approval. `id` is the proposal id to apply. */
export type Proposal = AgentReply & { id: string };
