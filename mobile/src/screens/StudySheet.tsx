import React, { useCallback, useEffect, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  RATINGS,
  withCards,
  type Doc,
  type Rating,
  type RevisionPlan,
  type StudyCard,
  type StudyExam,
  type StudyOverview,
  type SuggestedCard,
} from "@orbyn/core";
import { Button } from "../components/Button";
import { Chip, ChipRow } from "../components/Chip";
import { ErrorBanner } from "../components/ErrorBanner";
import { Sheet, sheetStyles } from "../components/Sheet";
import { SmallAction } from "../components/SmallAction";
import { client } from "../lib/api";
import { confirmAction } from "../lib/confirm";
import { deviceTimeZone } from "../lib/planning";
import { animateLayout } from "../motion";
import { colors, fonts, radii, themed } from "../theme";
import { shared } from "../styles";

type Mode =
  | { kind: "home" }
  | {
      kind: "review";
      docId?: string;
      title: string;
      quiz: boolean;
      ahead?: boolean;
    }
  | { kind: "suggest"; docId: string; title: string }
  | { kind: "plan"; exam: StudyExam };

const LABEL: Record<Rating, string> = {
  again: "Again",
  hard: "Hard",
  good: "Good",
  easy: "Easy",
};

const when = (iso: string, allDay: boolean) =>
  new Date(iso).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(allDay ? {} : { hour: "2-digit", minute: "2-digit" }),
  });

/**
 * Study on the phone, the same as the desktop: what's due, reviewing (flip
 * or quiz), cards the assistant suggests from a page to tick, exams with
 * pages attached, and revision sessions to approve.
 */
export function StudySheet({
  visible,
  onClose,
  onDismiss,
  onOpenPage,
  onPlanned,
}: {
  visible: boolean;
  onClose: () => void;
  onDismiss?: () => void;
  onOpenPage: (doc: Doc) => void;
  onPlanned: () => void;
}) {
  const [mode, setMode] = useState<Mode>({ kind: "home" });
  const [data, setData] = useState<StudyOverview | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(
    () => client.study().then(setData, (e: Error) => setError(e.message)),
    [],
  );
  useEffect(() => {
    if (visible) {
      setMode({ kind: "home" });
      void load();
    }
  }, [visible, load]);

  const openPage = (docId: string) =>
    void client
      .getDoc(docId)
      .then(onOpenPage, (e: Error) => setError(e.message));

  const title =
    mode.kind === "review"
      ? mode.quiz
        ? "Quiz"
        : "Review"
      : mode.kind === "suggest"
        ? "Suggested cards"
        : mode.kind === "plan"
          ? "Plan revision"
          : "Study";

  const home = () => {
    animateLayout();
    setMode({ kind: "home" });
    void load();
  };

  return (
    <Sheet
      visible={visible}
      title={title}
      onClose={onClose}
      onDismiss={onDismiss}
      onBack={mode.kind === "home" ? undefined : home}
    >
      <ScrollView
        contentContainerStyle={sheetStyles.body}
        keyboardShouldPersistTaps="handled"
      >
        <View style={sheetStyles.column}>
          <ErrorBanner error={error} onDismiss={() => setError("")} />
          {mode.kind === "review" ? (
            <Review
              {...mode}
              onError={setError}
              onOpenPage={openPage}
              onDone={(n) => {
                setNote(n ? `Reviewed ${n} card${n === 1 ? "" : "s"}.` : "");
                home();
              }}
            />
          ) : mode.kind === "suggest" ? (
            <Suggest
              docId={mode.docId}
              title={mode.title}
              onError={setError}
              onDone={(n) => {
                setNote(
                  n
                    ? `Added ${n} card${n === 1 ? "" : "s"} to ${mode.title}.`
                    : "",
                );
                home();
              }}
            />
          ) : mode.kind === "plan" ? (
            <Plan
              exam={mode.exam}
              onError={setError}
              onDone={(applied) => {
                if (applied) {
                  setNote(`Revision planned for ${mode.exam.title}.`);
                  onPlanned();
                }
                home();
              }}
            />
          ) : !data ? (
            <Text style={shared.small}>Loading your cards…</Text>
          ) : (
            <Home
              data={data}
              note={note}
              onError={setError}
              onChanged={setData}
              onMode={(m) => {
                animateLayout();
                setNote("");
                setMode(m);
              }}
              onOpenPage={openPage}
              onNewPage={() =>
                void client
                  .createDoc({
                    title: "Study notes",
                    kind: "note",
                    content: [
                      {
                        type: "paragraph",
                        text: "Write notes as usual. Any line written as Question :: Answer becomes a card.",
                      },
                      { type: "heading", level: 2, text: "Cards" },
                      {
                        type: "bullet",
                        text: "What does CAP stand for? :: Consistency, availability, partition tolerance",
                      },
                    ],
                  })
                  .then(onOpenPage, (e: Error) => setError(e.message))
              }
            />
          )}
        </View>
      </ScrollView>
    </Sheet>
  );
}

function Home({
  data,
  note,
  onError,
  onChanged,
  onMode,
  onOpenPage,
  onNewPage,
}: {
  data: StudyOverview;
  note: string;
  onError: (m: string) => void;
  onChanged: (d: StudyOverview) => void;
  onMode: (m: Mode) => void;
  onOpenPage: (docId: string) => void;
  onNewPage: () => void;
}) {
  const [choosing, setChoosing] = useState<string | null>(null);
  const [pages, setPages] = useState<{ id: string; title: string }[]>([]);
  const toReview = data.due_today + data.new_cards;
  useEffect(() => {
    client.listDocs().then(
      (all) =>
        setPages(
          all
            .filter(
              (d) =>
                d.kind !== "agenda" &&
                !data.decks.some((x) => x.doc_id === d.id),
            )
            .map((d) => ({ id: d.id, title: d.title || "Untitled" })),
        ),
      () => setPages([]),
    );
  }, [data.decks]);

  const attach = (exam: StudyExam, ids: string[]) =>
    void client
      .setExamDecks({
        key: exam.key,
        title: exam.title,
        starts_at: exam.starts_at,
        doc_ids: ids,
      })
      .then(onChanged, (e: Error) => onError(e.message));

  return (
    <>
      <View style={shared.card}>
        <Text style={s.kicker}>TODAY</Text>
        <Text style={s.heroCount}>
          {toReview
            ? `${toReview} card${toReview === 1 ? "" : "s"} to review`
            : "You're all caught up"}
        </Text>
        <Text style={shared.small}>
          {toReview
            ? `${data.due_today} due · ${data.new_cards} new · about ${Math.max(1, Math.round((toReview * 8) / 60))} min`
            : "Cards come back when they're about to slip."}
        </Text>
        <Button
          title="Start review"
          disabled={!toReview}
          style={s.gapTop}
          onPress={() =>
            onMode({ kind: "review", title: "All your cards", quiz: false })
          }
        />
        <View style={s.tiles}>
          <Stat label="Reviewed today" value={data.reviewed_today} />
          <Stat label="Day streak" value={data.streak} />
        </View>
        <View style={s.row}>
          <SmallAction
            label="New study page"
            disabled={false}
            onPress={onNewPage}
          />
          <SmallAction
            label="Make it a daily habit"
            disabled={false}
            onPress={() =>
              confirmAction(
                "Make a daily review a habit?",
                "Orbyn sets aside 15 minutes a day for reviewing cards.",
                "Add the habit",
                () =>
                  void client
                    .createHabit({
                      name: "Review cards",
                      cadence: 1,
                      period: "day",
                      duration_minutes: 15,
                    })
                    .then(
                      () => onError(""),
                      (e: Error) => onError(e.message),
                    ),
              )
            }
          />
        </View>
        {!!note && <Text style={[s.note, s.gapTop]}>{note}</Text>}
      </View>

      {data.exams.length > 0 && (
        <>
          <Text style={[shared.eyebrow, s.eyebrow]}>EXAMS COMING UP</Text>
          {data.exams.map((exam) => (
            <View key={exam.key} style={shared.card}>
              <View style={s.examHead}>
                <View style={s.date}>
                  <Text style={s.dateDay}>
                    {new Date(exam.starts_at).getDate()}
                  </Text>
                  <Text style={s.dateMonth}>
                    {new Date(exam.starts_at)
                      .toLocaleString("en-GB", { month: "short" })
                      .toUpperCase()}
                  </Text>
                </View>
                <View style={s.flex}>
                  <Text style={s.title}>{exam.title}</Text>
                  <Text style={shared.small}>
                    {when(exam.starts_at, exam.all_day)} ·{" "}
                    {exam.days_left === 0
                      ? "today"
                      : `in ${exam.days_left} day${exam.days_left === 1 ? "" : "s"}`}
                    {exam.readiness != null
                      ? ` · ${Math.round(exam.readiness * 100)}% known well`
                      : ""}
                  </Text>
                </View>
              </View>
              {exam.readiness != null && (
                <View style={s.bar}>
                  <View
                    style={[s.barFill, { width: `${exam.readiness * 100}%` }]}
                  />
                </View>
              )}
              {choosing === exam.key ? (
                <View style={s.gapTop}>
                  <Text style={shared.label}>Pages to revise</Text>
                  <ChipRow label="Pages to revise for this exam" multi>
                    {data.decks.map((d) => (
                      <Chip
                        key={d.doc_id}
                        multi
                        label={d.title}
                        selected={exam.doc_ids.includes(d.doc_id)}
                        onPress={() =>
                          attach(
                            exam,
                            exam.doc_ids.includes(d.doc_id)
                              ? exam.doc_ids.filter((x) => x !== d.doc_id)
                              : [...exam.doc_ids, d.doc_id],
                          )
                        }
                      />
                    ))}
                  </ChipRow>
                </View>
              ) : (
                <Text style={[shared.small, s.gapTop]}>
                  {exam.doc_ids.length
                    ? exam.doc_ids
                        .map(
                          (id) =>
                            data.decks.find((d) => d.doc_id === id)?.title ??
                            "Page",
                        )
                        .join(", ")
                    : "No pages attached yet."}
                </Text>
              )}
              <View style={s.row}>
                <SmallAction
                  label={choosing === exam.key ? "Done" : "Choose pages"}
                  disabled={false}
                  onPress={() =>
                    setChoosing(choosing === exam.key ? null : exam.key)
                  }
                />
                <SmallAction
                  label="Plan revision"
                  disabled={false}
                  onPress={() => onMode({ kind: "plan", exam })}
                />
                {exam.doc_ids.length === 1 && (
                  <SmallAction
                    label="Revise now"
                    disabled={false}
                    onPress={() =>
                      onMode({
                        kind: "review",
                        docId: exam.doc_ids[0],
                        title: exam.title,
                        quiz: false,
                        ahead: true,
                      })
                    }
                  />
                )}
              </View>
            </View>
          ))}
        </>
      )}

      <Text style={[shared.eyebrow, s.eyebrow]}>YOUR PAGES WITH CARDS</Text>
      {data.decks.length === 0 ? (
        <View style={shared.card}>
          <Text style={s.title}>Cards come from your own pages.</Text>
          <Text style={shared.body}>
            In any page, write a line as “Question :: Answer” and it becomes a
            card. Or pick a page of notes below and let the assistant suggest
            some for you to approve.
          </Text>
        </View>
      ) : (
        <View style={shared.card}>
          {data.decks.map((d, n) => (
            <View key={d.doc_id} style={[s.deck, n > 0 && s.divider]}>
              <Pressable
                accessibilityRole="button"
                onPress={() => onOpenPage(d.doc_id)}
              >
                <Text style={s.title} numberOfLines={1}>
                  {d.title}
                </Text>
              </Pressable>
              <View style={s.deckMeta}>
                <Text style={shared.small}>
                  {d.cards} card{d.cards === 1 ? "" : "s"} · {d.known} known
                  well
                </Text>
                {d.due > 0 && (
                  <Text style={[s.pill, s.pillWarn]}>{d.due} due</Text>
                )}
                {d.new > 0 && <Text style={s.pill}>{d.new} new</Text>}
              </View>
              <View style={[s.bar, s.barSlim]}>
                <View
                  style={[
                    s.barFill,
                    { width: `${d.cards ? (d.known / d.cards) * 100 : 0}%` },
                  ]}
                />
              </View>
              <View style={s.rowTight}>
                <SmallAction
                  label="Review"
                  disabled={!d.due && !d.new}
                  onPress={() =>
                    onMode({
                      kind: "review",
                      docId: d.doc_id,
                      title: d.title,
                      quiz: false,
                    })
                  }
                />
                <SmallAction
                  label="Quiz me"
                  disabled={false}
                  onPress={() =>
                    onMode({
                      kind: "review",
                      docId: d.doc_id,
                      title: d.title,
                      quiz: true,
                      ahead: true,
                    })
                  }
                />
                <SmallAction
                  label="Suggest"
                  disabled={false}
                  onPress={() =>
                    onMode({ kind: "suggest", docId: d.doc_id, title: d.title })
                  }
                />
              </View>
            </View>
          ))}
        </View>
      )}

      {pages.length > 0 && (
        <>
          <Text style={[shared.eyebrow, s.eyebrow]}>TURN NOTES INTO CARDS</Text>
          <View style={shared.card}>
            <Text style={shared.small}>
              Pick a page. The assistant suggests cards only from what it says,
              and you choose which to add.
            </Text>
            <ChipRow label="Pages of notes" style={s.gapTop}>
              {pages.slice(0, 12).map((p) => (
                <Chip
                  key={p.id}
                  label={p.title}
                  selected={false}
                  onPress={() =>
                    onMode({ kind: "suggest", docId: p.id, title: p.title })
                  }
                />
              ))}
            </ChipRow>
          </View>
        </>
      )}

      {data.weak.length > 0 && (
        <>
          <Text style={[shared.eyebrow, s.eyebrow]}>FORGOTTEN MOST</Text>
          <View style={shared.card}>
            {data.weak.map((w, n) => (
              <View key={w.id} style={[s.weak, n > 0 && s.divider]}>
                <Text style={shared.body}>{w.question}</Text>
                <Text style={shared.small}>forgotten {w.lapses}×</Text>
                <SmallAction
                  label={`Re-read ${w.doc_title}`}
                  disabled={false}
                  onPress={() => onOpenPage(w.doc_id)}
                />
              </View>
            ))}
          </View>
        </>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <View style={s.stat}>
      <Text style={shared.small}>{label}</Text>
      <Text style={s.statValue}>{value}</Text>
    </View>
  );
}

function Review({
  docId,
  title,
  quiz,
  ahead,
  onError,
  onOpenPage,
  onDone,
}: {
  docId?: string;
  title: string;
  quiz: boolean;
  ahead?: boolean;
  onError: (m: string) => void;
  onOpenPage: (docId: string) => void;
  onDone: (reviewed: number) => void;
}) {
  const [queue, setQueue] = useState<StudyCard[] | null>(null);
  const [shown, setShown] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const [answer, setAnswer] = useState("");
  const [grade, setGrade] = useState<{
    verdict: string;
    feedback: string;
    suggested_rating: Rating;
  } | null>(null);
  const [explained, setExplained] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    client
      .studyQueue({ docId, limit: quiz ? 15 : 100, ahead })
      .then(setQueue, (e: Error) => {
        onError(e.message);
        setQueue([]);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const card = queue?.[0];
  const rate = async (rating: Rating) => {
    if (!card || busy) return;
    setBusy(true);
    try {
      const next = await client.reviewCard(card.id, rating);
      setReviewed((n) => n + 1);
      animateLayout();
      setQueue((q) => {
        const rest = (q ?? []).slice(1);
        return rating === "again" && !quiz ? [...rest, next] : rest;
      });
      setShown(false);
      setAnswer("");
      setGrade(null);
      setExplained("");
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const total = reviewed + (queue?.length ?? 0);

  if (!queue) return <Text style={shared.small}>Getting your cards…</Text>;
  if (!card)
    return (
      <View style={shared.card}>
        <Text style={s.title}>
          {reviewed
            ? `Done. ${reviewed} card${reviewed === 1 ? "" : "s"} reviewed.`
            : "Nothing to review right now."}
        </Text>
        <Text style={shared.small}>
          Each card comes back when it's about to slip. The better you knew it,
          the longer the wait.
        </Text>
        <Button
          title="Back to Study"
          style={s.gapTop}
          onPress={() => onDone(reviewed)}
        />
      </View>
    );
  return (
    <>
      <View style={s.reviewHead}>
        <Text style={[shared.small, s.flex]} numberOfLines={1}>
          {quiz ? "Quiz" : "Review"} · {title}
        </Text>
        <Text style={s.count}>
          {Math.min(reviewed + 1, total)} / {total}
        </Text>
      </View>
      <View style={s.bar}>
        <View
          style={[
            s.barFill,
            { width: `${(reviewed / Math.max(1, total)) * 100}%` },
          ]}
        />
      </View>
      <View style={[shared.card, s.flash]}>
        <View style={s.flashTop}>
          <Pressable
            accessibilityRole="link"
            onPress={() => onOpenPage(card.doc_id)}
            style={s.source}
          >
            <Text style={s.sourceText} numberOfLines={1}>
              {card.doc_title}
            </Text>
          </Pressable>
          {card.reps === 0 && <Text style={s.pill}>New</Text>}
        </View>
        <View style={s.face}>
          <Text style={s.faceLabel}>QUESTION</Text>
          <Text style={[s.question, shown && s.questionSmall]}>
            {card.question}
          </Text>
        </View>
        {shown && (
          <View style={[s.face, s.faceAnswer]}>
            <Text style={s.faceLabel}>ANSWER</Text>
            <Text style={s.answerText}>{card.answer}</Text>
          </View>
        )}
      </View>
      {quiz && !shown && (
        <>
          <TextInput
            style={[shared.input, s.answerInput]}
            value={answer}
            onChangeText={setAnswer}
            multiline
            placeholder="Type your answer…"
            placeholderTextColor={colors.faint}
            accessibilityLabel="Your answer"
          />
          <View style={s.row}>
            <SmallAction
              label="I don't know"
              disabled={false}
              onPress={() => setShown(true)}
            />
            <SmallAction
              label={busy ? "Checking…" : "Check"}
              disabled={busy || !answer.trim()}
              onPress={() => {
                setBusy(true);
                client
                  .gradeAnswer(card.id, answer)
                  .then(setGrade, (e: Error) => onError(e.message))
                  .finally(() => {
                    setBusy(false);
                    setShown(true);
                  });
              }}
            />
          </View>
        </>
      )}
      {!quiz && !shown && (
        <Button title="Show answer" onPress={() => setShown(true)} />
      )}
      {shown && (
        <>
          {grade && (
            <Text style={[shared.body, s.callout]}>
              <Text style={s.verdict}>
                {grade.verdict === "correct"
                  ? "Right. "
                  : grade.verdict === "partly"
                    ? "Partly right. "
                    : "Not quite. "}
              </Text>
              {grade.feedback}
            </Text>
          )}
          {!!explained && (
            <Text style={[shared.body, s.callout]}>{explained}</Text>
          )}
          <Text style={[shared.small, s.center]}>
            How well did you know it?
          </Text>
          <View style={s.rate}>
            {RATINGS.map((r) => (
              <Pressable
                key={r}
                accessibilityRole="button"
                accessibilityLabel={`${LABEL[r]}, back in ${card.next[r]}`}
                disabled={busy}
                onPress={() => void rate(r)}
                style={[
                  s.rateButton,
                  grade?.suggested_rating === r && s.rateSuggested,
                ]}
              >
                <Text style={[s.rateLabel, RATE_TONE[r]]}>{LABEL[r]}</Text>
                <Text style={shared.small}>{card.next[r]}</Text>
              </Pressable>
            ))}
          </View>
        </>
      )}
      <View style={s.after}>
        {shown && !explained && (
          <SmallAction
            label="Explain this"
            disabled={busy}
            onPress={() =>
              void client.explainCard(card.id).then(
                (r) =>
                  setExplained(
                    r.explanation +
                      (r.beyond_notes ? " (Goes beyond your notes.)" : ""),
                  ),
                (e: Error) => onError(e.message),
              )
            }
          />
        )}
        <SmallAction
          label="Finish"
          disabled={false}
          onPress={() => onDone(reviewed)}
        />
      </View>
    </>
  );
}

function Suggest({
  docId,
  title,
  onError,
  onDone,
}: {
  docId: string;
  title: string;
  onError: (m: string) => void;
  onDone: (added: number) => void;
}) {
  const [cards, setCards] = useState<
    (SuggestedCard & { keep: boolean })[] | null
  >(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    client.suggestCards(docId).then(
      (r) => setCards(r.cards.map((c) => ({ ...c, keep: true }))),
      (e: Error) => {
        onError(e.message);
        setCards([]);
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);
  const kept = (cards ?? []).filter(
    (c) => c.keep && c.question.trim() && c.answer.trim(),
  );
  const update = (
    i: number,
    patch: Partial<SuggestedCard & { keep: boolean }>,
  ) =>
    setCards(
      (cs) => cs?.map((c, n) => (n === i ? { ...c, ...patch } : c)) ?? cs,
    );
  if (!cards) return <Text style={shared.small}>Reading “{title}”…</Text>;
  return (
    <>
      <Text style={shared.small}>
        Suggested from “{title}” only. Untick any you don't want and fix the
        wording before adding.
      </Text>
      {cards.length === 0 && (
        <Text style={[shared.body, s.gapTop]}>
          No new cards to suggest from this page.
        </Text>
      )}
      {cards.map((c, i) => (
        <View key={i} style={[shared.card, !c.keep && s.off]}>
          <View style={s.suggestHead}>
            <Text style={shared.label}>Card {i + 1}</Text>
            <Switch
              value={c.keep}
              trackColor={{ true: colors.accent }}
              accessibilityLabel={`Keep card ${i + 1}`}
              onValueChange={(keep) => update(i, { keep })}
            />
          </View>
          <TextInput
            style={shared.input}
            value={c.question}
            onChangeText={(question) => update(i, { question })}
            accessibilityLabel={`Question ${i + 1}`}
          />
          <TextInput
            style={[shared.input, s.gapTopSmall]}
            value={c.answer}
            onChangeText={(answer) => update(i, { answer })}
            accessibilityLabel={`Answer ${i + 1}`}
          />
          {!!c.source && (
            <Text style={[shared.small, s.gapTopSmall]}>
              From: “{c.source}”
            </Text>
          )}
        </View>
      ))}
      <Button
        title={
          saving
            ? "Adding…"
            : `Add ${kept.length} card${kept.length === 1 ? "" : "s"} to the page`
        }
        disabled={saving || !kept.length}
        onPress={() => {
          setSaving(true);
          client
            .getDoc(docId)
            .then((doc) =>
              client.updateDoc(docId, {
                version: doc.version,
                content: withCards(doc.content, kept),
              }),
            )
            .then(
              () => onDone(kept.length),
              (e: Error) => {
                onError(e.message);
                setSaving(false);
              },
            );
        }}
      />
    </>
  );
}

function Plan({
  exam,
  onError,
  onDone,
}: {
  exam: StudyExam;
  onError: (m: string) => void;
  onDone: (applied: boolean) => void;
}) {
  const [minutes, setMinutes] = useState(30);
  const [plan, setPlan] = useState<RevisionPlan | null>(null);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setPlan(null);
    client
      .planRevision({ key: exam.key, minutes, timezone: deviceTimeZone() })
      .then(setPlan, (e: Error) => onError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exam.key, minutes]);
  const chosen = (plan?.sessions ?? []).filter((x) => !off.has(x.start_at));
  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    });
  return (
    <>
      <Text style={s.title}>{exam.title}</Text>
      <Text style={shared.small}>
        One session a day in your free working time, around classes and events,
        a little longer in the last three days. Nothing is added until you apply
        it.
      </Text>
      <ChipRow label="Session length" style={s.gapTop}>
        {[20, 30, 45, 60].map((m) => (
          <Chip
            key={m}
            label={`${m} min`}
            selected={minutes === m}
            onPress={() => setMinutes(m)}
          />
        ))}
      </ChipRow>
      {!plan ? (
        <Text style={[shared.small, s.gapTop]}>Finding free time…</Text>
      ) : (
        <View style={[shared.card, s.gapTop]}>
          {plan.sessions.length === 0 && (
            <Text style={shared.body}>
              No free working time before the exam.
            </Text>
          )}
          {plan.sessions.map((x, n) => (
            <View key={x.start_at} style={[s.session, n > 0 && s.divider]}>
              <Text style={[shared.body, { flex: 1 }]}>
                {new Date(x.start_at).toLocaleDateString("en-GB", {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                })}{" "}
                · {time(x.start_at)}–{time(x.end_at)}
              </Text>
              <Switch
                value={!off.has(x.start_at)}
                trackColor={{ true: colors.accent }}
                accessibilityLabel={`Keep the session on ${x.start_at}`}
                onValueChange={(on) =>
                  setOff((o) => {
                    const next = new Set(o);
                    if (on) next.delete(x.start_at);
                    else next.add(x.start_at);
                    return next;
                  })
                }
              />
            </View>
          ))}
          {plan.skipped_days.length > 0 && (
            <Text style={[shared.small, s.gapTop]}>
              No free time on {plan.skipped_days.length} day
              {plan.skipped_days.length === 1 ? "" : "s"}.
            </Text>
          )}
        </View>
      )}
      <Button
        title={
          saving
            ? "Adding…"
            : `Add ${chosen.length} session${chosen.length === 1 ? "" : "s"}`
        }
        disabled={saving || !chosen.length}
        onPress={() => {
          setSaving(true);
          client.applyRevision({ key: exam.key, sessions: chosen }).then(
            () => onDone(true),
            (e: Error) => {
              onError(e.message);
              setSaving(false);
            },
          );
        }}
      />
    </>
  );
}

const s = themed(() =>
  StyleSheet.create({
    kicker: {
      fontFamily: fonts.semibold,
      fontSize: 11,
      letterSpacing: 1,
      color: colors.muted,
    },
    heroCount: {
      fontFamily: fonts.display,
      fontSize: 24,
      lineHeight: 30,
      color: colors.text,
      marginTop: 4,
      marginBottom: 2,
    },
    tiles: { flexDirection: "row", gap: 10, marginTop: 14 },
    stat: {
      flex: 1,
      gap: 2,
      padding: 12,
      borderRadius: radii.input,
      backgroundColor: colors.surfaceMuted,
    },
    statValue: {
      fontFamily: fonts.display,
      fontSize: 22,
      color: colors.text,
    },
    note: { fontFamily: fonts.medium, fontSize: 13, color: colors.accent },
    flex: { flex: 1, minWidth: 0 },
    center: { textAlign: "center", marginTop: 10, marginBottom: 2 },
    after: {
      flexDirection: "row",
      justifyContent: "center",
      gap: 8,
      marginTop: 8,
    },
    rowTight: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
    examHead: { flexDirection: "row", alignItems: "center", gap: 12 },
    date: {
      width: 48,
      height: 52,
      borderRadius: radii.input,
      backgroundColor: colors.accentSoft,
      alignItems: "center",
      justifyContent: "center",
    },
    dateDay: { fontFamily: fonts.display, fontSize: 19, color: colors.accent },
    dateMonth: {
      fontFamily: fonts.semibold,
      fontSize: 10,
      letterSpacing: 0.6,
      color: colors.accent,
    },
    deck: { gap: 6, paddingVertical: 12 },
    deckMeta: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 6,
    },
    pill: {
      overflow: "hidden",
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: radii.pill,
      backgroundColor: colors.accentSoft,
      color: colors.accent,
      fontFamily: fonts.semibold,
      fontSize: 11,
    },
    pillWarn: {
      backgroundColor: colors.warningSoft,
      color: colors.warningStrong,
    },
    barSlim: { height: 5, marginTop: 4, marginBottom: 4 },
    reviewHead: { flexDirection: "row", alignItems: "center", gap: 12 },
    count: { fontFamily: fonts.semibold, fontSize: 13, color: colors.text },
    flashTop: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
    },
    source: {
      flexShrink: 1,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: radii.pill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    sourceText: { fontFamily: fonts.medium, fontSize: 12, color: colors.muted },
    face: { alignItems: "center", gap: 8, paddingVertical: 18 },
    faceAnswer: {
      paddingTop: 18,
      borderTopWidth: 1,
      borderStyle: "dashed",
      borderTopColor: colors.border,
    },
    faceLabel: {
      fontFamily: fonts.semibold,
      fontSize: 10.5,
      letterSpacing: 1,
      color: colors.muted,
    },
    questionSmall: { fontSize: 17, lineHeight: 23 },
    callout: {
      padding: 12,
      borderRadius: radii.input,
      backgroundColor: colors.surfaceMuted,
      overflow: "hidden",
    },
    row: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
    gapTop: { marginTop: 12 },
    gapTopSmall: { marginTop: 8 },
    eyebrow: { marginTop: 8 },
    title: {
      fontFamily: fonts.semibold,
      fontSize: 16,
      color: colors.text,
      marginBottom: 2,
    },
    bar: {
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.surfaceMuted,
      overflow: "hidden",
      marginTop: 10,
      marginBottom: 10,
    },
    barFill: {
      height: "100%",
      backgroundColor: colors.accent,
      borderRadius: 3,
    },
    flash: { gap: 4, minHeight: 220 },
    question: {
      fontFamily: fonts.display,
      fontSize: 22,
      lineHeight: 29,
      color: colors.text,
      textAlign: "center",
    },
    answerText: {
      fontFamily: fonts.regular,
      fontSize: 17,
      lineHeight: 24,
      color: colors.text,
      textAlign: "center",
    },
    answerInput: { minHeight: 80, textAlignVertical: "top" },
    verdict: { fontFamily: fonts.semibold },
    rate: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    rateButton: {
      flexGrow: 1,
      flexBasis: "22%",
      minWidth: 70,
      alignItems: "center",
      paddingVertical: 10,
      borderRadius: radii.input,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    rateSuggested: {
      borderColor: colors.accent,
      backgroundColor: colors.accentSoft,
    },
    rateLabel: { fontFamily: fonts.semibold, fontSize: 14, color: colors.text },
    weak: { gap: 4, paddingVertical: 8 },
    divider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    suggestHead: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 8,
    },
    off: { opacity: 0.5 },
    session: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingVertical: 8,
    },
  }),
);

const RATE_TONE = {
  get again() {
    return { color: colors.danger };
  },
  get hard() {
    return { color: colors.warningStrong };
  },
  get good() {
    return { color: colors.accent };
  },
  get easy() {
    return { color: colors.accent };
  },
} as Record<Rating, { color: string }>;
