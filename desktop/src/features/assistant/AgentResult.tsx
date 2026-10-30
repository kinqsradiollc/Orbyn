import {
  ASSISTANT_OUTCOME_LABELS,
  assistantOutcomeDetails,
  type AssistantProfile,
} from "@orbyn/core";
import { AssistantHandoffAction } from "./AssistantHandoffAction";

type Output = AssistantProfile["outputs"][number];
/** Result evidence precedes optional transcripts and follow-up delegation. */
export function AgentResult({
  output,
  lane,
  onOpenChat,
}: {
  output: Output;
  lane: "background" | "overnight";
  onOpenChat: (id: string) => void;
}) {
  const receipt = output.execution_outcome;
  return (
    <article className="agent-result">
      <div className="agent-result-head">
        <div>
          <h4>{output.title || "Untitled result"}</h4>
          <p>
            {receipt
              ? ASSISTANT_OUTCOME_LABELS[receipt.outcome]
              : output.state === "failed"
                ? "Run failed"
                : "Run finished · Review outcome"}
          </p>
        </div>
        <button
          className="secondary"
          onClick={() => onOpenChat(output.chat_id)}
        >
          {receipt?.outcome === "waiting" ? "Review decision" : "Open result"}
        </button>
      </div>
      {output.summary && (
        <p className="agent-result-summary">{output.summary}</p>
      )}
      <time dateTime={output.completed_at}>
        {new Date(output.completed_at).toLocaleString()}
      </time>
      {receipt && (
        <details>
          <summary>Evidence &amp; open questions</summary>
          <ul>
            {assistantOutcomeDetails(receipt).map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </details>
      )}
      <details>
        <summary>Continue this work</summary>
        <AssistantHandoffAction
          jobId={output.job_id}
          title={output.title}
          lane={lane}
          existing={output.handoff}
          onOpenChat={onOpenChat}
        />
      </details>
    </article>
  );
}
