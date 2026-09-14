import { useEffect, useState } from "react";
import type { Proposal } from "@orbyn/core";
import { client } from "../lib/api";
import type { Planner } from "./usePlanner";

/** Chat message draft plus the pending AI proposal and its apply/dismiss flow. */
export function useAssistant({
  token,
  act,
  refresh,
}: Pick<Planner, "token" | "act" | "refresh">) {
  const [message, setMessage] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);

  // A cleared session (sign out or 401) also drops any pending proposal.
  useEffect(() => {
    if (!token) setProposal(null);
  }, [token]);

  const ask = (text = message) =>
    act(async () => {
      setProposal(
        await client.chat(
          text,
          Intl.DateTimeFormat().resolvedOptions().timeZone,
        ),
      );
      setMessage("");
    });

  const apply = () => {
    if (!proposal) return Promise.resolve();
    return act(async () => {
      await client.applyProposal(proposal.id);
      setProposal({
        ...proposal,
        summary: "Your changes are saved.",
        actions: [],
      });
      await refresh();
    });
  };

  const dismiss = () => setProposal(null);

  return { message, setMessage, proposal, ask, apply, dismiss };
}

export type Assistant = ReturnType<typeof useAssistant>;
