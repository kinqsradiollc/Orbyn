import {
  type AiFeatureProvider,
  type Rating,
  type StudyCard,
  type StudyOverview,
  type SuggestedCard,
} from "@orbyn/core";
import type { OrbynClient } from "../client.js";

// ---- study ----
/** Cards due, pages with cards, exams, streak and weak spots. */

export function callStudy(this: OrbynClient) {
  return this.request<StudyOverview>("/study");
}

/** Cards to review now (due, then today's new ones); one page with `docId`. */

export function callStudyQueue(
  this: OrbynClient,
  options: { docId?: string; limit?: number; ahead?: boolean } = {},
) {
  const q = new URLSearchParams();
  if (options.docId) q.set("doc_id", options.docId);
  if (options.limit) q.set("limit", String(options.limit));
  if (options.ahead) q.set("ahead", "true");
  const s = q.toString();
  return this.request<StudyCard[]>(`/study/queue${s ? `?${s}` : ""}`);
}

/** Which pages you're revising for an exam. */

export function callSetExamDecks(
  this: OrbynClient,
  input: {
    key: string;
    title: string;
    starts_at: string;
    doc_ids: string[];
  },
) {
  return this.request<StudyOverview>("/study/exams", {
    method: "PUT",
    body: input,
  });
}

/** The assistant's suggested cards from a page — a proposal to tick. */

export function callSuggestCards(
  this: OrbynClient,
  docId: string,
  max?: number,
) {
  return this.request<{
    cards: SuggestedCard[];
    provider?: AiFeatureProvider;
  }>(`/ai/study/pages/${docId}/cards`, {
    method: "POST",
    body: max ? { max } : {},
  });
}

/** Grade a typed answer against the card and its page. */

export function callGradeAnswer(
  this: OrbynClient,
  cardId: string,
  answer: string,
) {
  return this.request<{
    provider?: AiFeatureProvider;
    verdict: "correct" | "partly" | "wrong";
    feedback: string;
    suggested_rating: Rating;
  }>("/ai/study/grade", {
    method: "POST",
    body: { card_id: cardId, answer },
  });
}

export function callExplainCard(this: OrbynClient, cardId: string) {
  return this.request<{
    explanation: string;
    beyond_notes: boolean;
    provider?: AiFeatureProvider;
  }>(`/ai/study/cards/${cardId}/explain`, { method: "POST", body: {} });
}
