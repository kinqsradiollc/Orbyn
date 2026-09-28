import { useEffect, useState } from "react";
import { ArrowRight, Sparkles } from "lucide-react";
import type { AssistantIdea } from "@orbyn/core";
import { client } from "../../lib/api";

/** Ready-to-review ideas surfaced beside today's plan. */
export function AssistantIdeasCard({ onReview }: { onReview: () => void }) {
  const [ideas, setIdeas] = useState<AssistantIdea[]>([]);
  const [agentName, setAgentName] = useState("Orbyn");
  useEffect(() => {
    let live = true;
    void client
      .agentSettings()
      .then((value) => live && setAgentName(value.name || "Orbyn"))
      .catch(() => undefined);
    void client
      .assistantIdeas()
      .then(
        (rows) =>
          live &&
          setIdeas(
            rows
              .filter((idea) => idea.status === "pending" && idea.proposal_id)
              .slice(0, 3),
          ),
      )
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  if (!ideas.length) return null;
  return (
    <section
      className="card overview-section assistant-ideas"
      aria-labelledby="assistant-ideas-title"
    >
      <div className="section-heading">
        <div>
          <h2 id="assistant-ideas-title">
            <Sparkles size={16} aria-hidden="true" className="heading-icon" />
            For today
          </h2>
          <p className="section-hint">
            A few ideas from {agentName}, ready for Review.
          </p>
        </div>
        <button type="button" className="text-button" onClick={onReview}>
          Review <ArrowRight size={14} aria-hidden="true" />
        </button>
      </div>
      <ul className="assistant-ideas-list">
        {ideas.map((idea) => (
          <li key={idea.id}>
            <div>
              <strong>{idea.title}</strong>
              <p>{idea.summary}</p>
            </div>
            <button type="button" className="text-button" onClick={onReview}>
              Review
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
