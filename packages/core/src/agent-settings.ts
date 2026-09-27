import { z } from "zod";

export const agentSettingsInput = z
  .object({
    name: z.string().trim().min(1).max(40),
    persona: z.string().trim().max(1000).default(""),
  })
  .strict();

export type AgentIdentityInput = z.input<typeof agentSettingsInput>;
export type PersonalAgentSettings = {
  name: string;
  persona: string;
  named_at: string | null;
  updated_at: string;
};
