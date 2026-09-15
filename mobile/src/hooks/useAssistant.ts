import { useEffect, useState } from "react";
import type { Proposal } from "@orbyn/core";
import { client } from "../lib/api";

type Options = {
  /** Current session token; the pending proposal is dropped when it clears. */
  token: string;
  act: (fn: () => Promise<void>) => Promise<void>;
  refresh: () => Promise<void>;
};

/** Draft message + pending AI proposal, with ask() and apply(). */
export function useAssistant({ token, act, refresh }: Options) {
  const [message, setMessage] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);

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

  const apply = () =>
    act(async () => {
      if (!proposal) return;
      await client.applyProposal(proposal.id);
      setProposal({
        ...proposal,
        summary: "Your changes are saved.",
        actions: [],
      });
      await refresh();
    });

  const discard = () => setProposal(null);

  return { message, setMessage, proposal, ask, apply, discard };
}

export type Assistant = ReturnType<typeof useAssistant>;
