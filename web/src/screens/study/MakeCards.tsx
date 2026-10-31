import {
  aiFeatureProviderLabel,
  docContainerBlocks,
  withCards,
  type DocBlock,
  type SuggestedCard,
} from "@orbyn/core";
import { useEffect, useRef, useState } from "react";
import { messageOf } from "../../lib/resource";
import { client } from "../../lib/session";
import {
  Button,
  Dialog,
  ErrorNotice,
  Loading,
  TextArea,
  useToast,
} from "../../ui/kit";
import "./study.css";

type Card = SuggestedCard & { keep: boolean };

/** Suggested cards from a page, each editable before it is added. */
export function MakeCards({
  docId,
  title,
  max,
  onClose,
}: {
  docId: string;
  title: string;
  max?: number;
  onClose: (added: number) => void;
}) {
  const toast = useToast();
  const [cards, setCards] = useState<Card[] | null>(null);
  const [provider, setProvider] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const additions = useRef<{ blocks: DocBlock[]; count: number } | null>(null);
  useEffect(() => {
    let live = true;
    setError("");
    client.suggestCards(docId, max).then(
      (result) => {
        if (!live) return;
        setProvider(
          result.provider ? aiFeatureProviderLabel(result.provider) : "",
        );
        setCards(result.cards.map((card) => ({ ...card, keep: true })));
      },
      (failure) =>
        live && setError(messageOf(failure, "Couldn't suggest cards.")),
    );
    return () => {
      live = false;
    };
  }, [docId, max, attempt]);
  const update = (index: number, change: Partial<Card>) =>
    setCards(
      (all) =>
        all?.map((card, at) =>
          at === index ? { ...card, ...change } : card,
        ) ?? all,
    );
  const kept = (cards ?? []).filter(
    (card) => card.keep && card.question.trim() && card.answer.trim(),
  );
  const add = async () => {
    if (!kept.length) return;
    setSaving(true);
    setError("");
    try {
      additions.current ??= {
        blocks: withCards([], kept).map((block) => ({
          ...block,
          id: block.id ?? crypto.randomUUID(),
        })),
        count: kept.length,
      };
      const adding = additions.current;
      const doc = await client.getDocForEditor(docId);
      const document = doc.document ?? {
        format: 1 as const,
        blocks: doc.content,
      };
      const blocks =
        document.format === 1
          ? document.blocks
          : docContainerBlocks(document.nodes);
      const ids = new Set(blocks.map((block) => block.id).filter(Boolean));
      const found = adding.blocks.filter(
        (block) => block.id && ids.has(block.id),
      ).length;
      if (found && found !== adding.blocks.length)
        throw new Error(
          "Some added cards changed. Review the page before adding more.",
        );
      if (!found)
        await client.updateDocForEditor(docId, {
          version: doc.version,
          document:
            document.format === 2
              ? {
                  format: 2,
                  nodes: [
                    ...document.nodes,
                    ...adding.blocks.map((block) => ({
                      kind: "block" as const,
                      block,
                    })),
                  ],
                }
              : { format: 1, blocks: [...document.blocks, ...adding.blocks] },
        });
      toast({ text: `${adding.count} cards added.` });
      onClose(adding.count);
    } catch (failure) {
      setError(messageOf(failure, "Couldn't add these cards."));
      setSaving(false);
    }
  };
  return (
    <Dialog
      title={`Cards from ${title}`}
      wide
      onClose={() => !saving && onClose(0)}
      actions={
        <>
          <Button variant="ghost" disabled={saving} onClick={() => onClose(0)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={saving}
            disabled={!kept.length}
            onClick={() => void add()}
          >
            Add {kept.length} card{kept.length === 1 ? "" : "s"}
          </Button>
        </>
      }
    >
      {provider && <small className="muted">{provider}</small>}
      {error && (
        <ErrorNotice
          message={error}
          onRetry={cards ? undefined : () => setAttempt((n) => n + 1)}
        />
      )}
      {cards === null && !error && <Loading label="Reading your notes" />}
      {cards?.length === 0 && (
        <p className="small muted">No new cards to suggest.</p>
      )}
      {!!cards?.length && (
        <p className="small muted">Edit or deselect cards before adding.</p>
      )}
      <ul className="study-suggested">
        {cards?.map((card, index) => (
          <li key={index} data-off={!card.keep || undefined}>
            <input
              type="checkbox"
              aria-label={`Keep card ${index + 1}`}
              checked={card.keep}
              disabled={saving}
              onChange={(event) =>
                update(index, { keep: event.currentTarget.checked })
              }
            />
            <div className="study-suggested-body">
              <TextArea
                aria-label={`Question ${index + 1}`}
                dir="auto"
                rows={2}
                maxLength={500}
                disabled={saving}
                value={card.question}
                onChange={(event) =>
                  update(index, { question: event.currentTarget.value })
                }
              />
              <TextArea
                aria-label={`Answer ${index + 1}`}
                dir="auto"
                rows={3}
                maxLength={1000}
                disabled={saving}
                value={card.answer}
                onChange={(event) =>
                  update(index, { answer: event.currentTarget.value })
                }
              />
              {card.source && (
                <details className="small">
                  <summary>Source</summary>
                  <p dir="auto">{card.source}</p>
                </details>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
