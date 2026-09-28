import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  dateLabel,
  type AgentQuestion,
  type Notice,
  type PageMention,
} from "@orbyn/core";
import { client } from "../lib/api";
import { Icon, type IconName } from "../components/Icon";
import { SmallAction } from "../components/SmallAction";
import { AsksList } from "../components/followthrough/Asks";
import { FadeIn, Pressable } from "../motion";
import { colors, fonts, radii, themed } from "../theme";
import { shared } from "../styles";

const ICONS: Partial<Record<NonNullable<Notice["kind"]>, IconName>> = {
  conflict: "alert",
  booking: "calendarCheck",
  rollforward: "arrowRight",
  at_risk: "alert",
  deadline: "clock",
  rsvp: "users",
  template: "layoutGrid",
  project: "boxes",
  mention: "atSign",
  session: "timer",
  review: "inbox",
  question: "comment",
  system: "clock",
};

/**
 * Questions your agents asked (ask_person) that wait for you: each choice
 * is a button, and the answer goes straight back to the agent. Read again
 * whenever the notices change (a new question arrives as one).
 */
function AgentQuestions({ notices }: { notices: Notice[] }) {
  const [list, setList] = useState<AgentQuestion[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    client.agentQuestions().then(setList, () => {});
  }, [notices]);
  if (!list.length) return null;
  const answer = (q: AgentQuestion, choice: string) => {
    setPending(q.id);
    setError(null);
    client
      .answerAgentQuestion(q.id, choice)
      .then(
        () => setList((all) => all.filter((x) => x.id !== q.id)),
        (e: Error) => setError(e.message),
      )
      .finally(() => setPending(null));
  };
  return (
    <FadeIn style={[shared.card, s.questions]}>
      <Text style={shared.sectionTitle} accessibilityRole="header">
        Your agents ask
      </Text>
      {list.map((q, n) => (
        <View key={q.id} style={[s.question, n > 0 && s.divider]}>
          <Text style={s.title}>{q.question}</Text>
          {!!q.detail && <Text style={s.body}>{q.detail}</Text>}
          <Text style={shared.small}>
            {q.agent} · {dateLabel(q.created_at)}
            {q.default_choice
              ? ` · “${q.default_choice}” if you don’t answer in time`
              : ""}
          </Text>
          <View style={s.choices}>
            {q.choices.map((c) => (
              <SmallAction
                key={c}
                label={c}
                disabled={pending === q.id}
                onPress={() => answer(q, c)}
              />
            ))}
          </View>
        </View>
      ))}
      {!!error && <Text style={[shared.small, s.error]}>{error}</Text>}
    </FadeIn>
  );
}

/**
 * "Mentioned in": the pages that name you, newest first, with the line
 * around the mention. Only pages you can still open are listed.
 */
function MentionedIn({ onOpen }: { onOpen: (docId: string) => void }) {
  const [list, setList] = useState<PageMention[]>([]);
  useEffect(() => {
    client.mentions(20).then(setList, () => setList([]));
  }, []);
  if (!list.length) return null;
  return (
    <FadeIn style={[shared.card, s.mentions]}>
      <Text style={shared.sectionTitle} accessibilityRole="header">
        Mentioned in
      </Text>
      {list.slice(0, 5).map((m, n) => (
        <Pressable
          key={`${m.doc_id}:${m.block_id}`}
          accessibilityRole="button"
          accessibilityLabel={`${m.title || "Untitled"}, ${m.quote}`}
          accessibilityHint="Opens the page"
          onPress={() => onOpen(m.doc_id)}
          style={({ pressed }) => [
            s.mention,
            n > 0 && s.divider,
            pressed && { opacity: 0.7 },
          ]}
        >
          <Text style={s.title} numberOfLines={1}>
            {m.title || "Untitled"}
          </Text>
          {!!m.quote && (
            <Text style={s.body} numberOfLines={2}>
              {m.quote}
            </Text>
          )}
          <Text style={shared.small}>
            {m.mentioned_by ? `${m.mentioned_by} · ` : ""}
            {dateLabel(m.created_at)}
          </Text>
        </Pressable>
      ))}
    </FadeIn>
  );
}

/**
 * Reminders and planner notices. Tapping one marks it read (or opens its
 * booking); planner notices also offer their action: Reschedule a clashing
 * block, Roll forward unfinished work, or Plan a task that's at risk or due
 * soon.
 */
export function InboxScreen({
  notices,
  busy,
  onRead,
  onReschedule,
  onOpenBooking,
  onRollForward,
  onPlanIt,
  onOpenItem,
  onOpenTemplate,
  onOpenProject,
  onOpenItemById,
  onOpenDoc,
  onOpenPage,
  onStartSession,
  reviewPending = 0,
  onOpenReview,
  onOpenAgents,
  onOpenChat,
  onOpenOvernight,
}: {
  notices: Notice[];
  busy: boolean;
  onRead: (notice: Notice) => void;
  /** Move the clashing time block in a "conflict" notice to the next free time. */
  onReschedule: (notice: Notice) => void;
  /** Open the booking a "booking" notice is about (its `ref`). */
  onOpenBooking: (notice: Notice) => void;
  /** Plan unfinished work forward ("rollforward" notices). */
  onRollForward: (notice: Notice) => void;
  /** Preview a plan that includes the notice's task ("at_risk", "deadline"). */
  onPlanIt: (notice: Notice) => void;
  /** Open the event an "rsvp" notice is about (`item_id`). */
  onOpenItem: (notice: Notice) => void;
  /** Review a template that's ready to start ("template", `ref` = template). */
  onOpenTemplate?: (notice: Notice) => void;
  onOpenProject?: (notice: Notice) => void;
  /** Open a task an ask is about. */
  onOpenItemById?: (itemId: string) => void;
  /** Open the page an "import" notice is about (`ref` = "doc:<id>"). */
  onOpenDoc?: (notice: Notice, docId: string) => void;
  /** Open a page by id ("Mentioned in"). */
  onOpenPage?: (docId: string) => void;
  /** Start a session from its reminder ("session" notices), in focus mode. */
  onStartSession?: (notice: Notice) => void;
  /** Proposals waiting in Review (agents' and the assistant's). */
  reviewPending?: number;
  /** Open Review, on one proposal (a "review" notice) or the whole inbox. */
  onOpenReview?: (proposalId: string | null, notice?: Notice) => void;
  /**
   * Open Settings → Connected agents, from an "agent" notice about one
   * connection (`ref` = "grant:<id>"), e.g. a big job it finished.
   */
  onOpenAgents?: (notice: Notice) => void;
  /** Reopen the saved assistant chat behind a notice. */
  onOpenChat?: (notice: Notice, chatId: string) => void;
  onOpenOvernight?: (notice: Notice) => void;
}) {
  const review =
    reviewPending > 0 && onOpenReview ? (
      <Pressable
        accessibilityRole="button"
        onPress={() => onOpenReview(null)}
        style={({ pressed }) => [
          shared.card,
          s.review,
          pressed && { opacity: 0.7 },
        ]}
      >
        <View style={s.icon}>
          <Icon name="inbox" size={16} color={colors.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.reviewTitle}>
            {reviewPending === 1
              ? "1 suggestion waits for you"
              : `${reviewPending} suggestions wait for you`}
          </Text>
          <Text style={shared.small}>
            Approve or decline what your agents suggest.
          </Text>
        </View>
        <Icon name="chevronRight" size={16} color={colors.muted} />
      </Pressable>
    ) : null;
  const asks = (
    <>
      <AgentQuestions notices={notices} />
      {review}
      {onOpenPage && <MentionedIn onOpen={onOpenPage} />}
      {onOpenItemById ? <AsksList onOpenItem={onOpenItemById} /> : null}
    </>
  );
  if (!notices.length)
    return (
      <>
        {asks}
        <FadeIn style={[shared.card, shared.empty]}>
          <View style={shared.emptyIcon}>
            <Icon name="bell" size={24} color={colors.accent} />
          </View>
          <Text style={shared.sectionTitle}>You’re all caught up.</Text>
          <Text style={[shared.subtitle, { textAlign: "center" }]}>
            Reminders, planner notices and booking updates will appear here.
          </Text>
        </FadeIn>
      </>
    );
  return (
    <View style={s.list}>
      {asks}
      {notices.map((n, i) => {
        const booking = n.kind === "booking" && !!n.ref;
        // An imported file that's ready points at its page.
        const docId =
          (n.kind === "import" || n.kind === "mention") &&
          n.ref?.startsWith("doc:")
            ? n.ref.slice(4).split(":")[0]
            : null;
        const proposal =
          n.kind === "review" && n.ref?.startsWith("proposal:")
            ? n.ref.slice("proposal:".length)
            : null;
        const grant =
          n.kind === "agent" && !!n.ref?.startsWith("grant:") && !!onOpenAgents;
        const action =
          n.kind === "assistant" &&
          n.ref?.startsWith("overnight:") &&
          onOpenOvernight
            ? { label: "Review Overnight", run: onOpenOvernight }
            : (n.kind === "assistant" || n.kind === "reminder_nudge") &&
                n.ref?.startsWith("chat:") &&
                onOpenChat
              ? {
                  label: "Open chat",
                  run: (x: Notice) => onOpenChat(x, x.ref!.split(":")[1]),
                }
              : n.kind === "session" && n.ref && n.item_id && onStartSession
                ? { label: "Start", run: onStartSession }
                : proposal && onOpenReview
                  ? {
                      label: "Review",
                      run: (x: Notice) => onOpenReview(proposal, x),
                    }
                  : n.kind === "conflict" && n.ref
                    ? { label: "Reschedule", run: onReschedule }
                    : n.kind === "rollforward"
                      ? { label: "Roll forward", run: onRollForward }
                      : n.kind === "at_risk" || n.kind === "deadline"
                        ? { label: "Plan it", run: onPlanIt }
                        : n.kind === "rsvp" && n.item_id
                          ? { label: "Open event", run: onOpenItem }
                          : n.kind === "template" && n.ref && onOpenTemplate
                            ? { label: "Review", run: onOpenTemplate }
                            : n.kind === "project" && n.ref && onOpenProject
                              ? { label: "Open project", run: onOpenProject }
                              : docId && onOpenDoc
                                ? {
                                    label: "Open page",
                                    run: (x: Notice) => onOpenDoc(x, docId),
                                  }
                                : grant && onOpenAgents
                                  ? {
                                      label: "Open Connected agents",
                                      run: onOpenAgents,
                                    }
                                  : null;
        return (
          <FadeIn key={n.id} index={i} style={[i > 0 && s.divider]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={n.title + (n.read ? "" : ", unread")}
              accessibilityHint={
                booking
                  ? "Opens this booking"
                  : n.read
                    ? undefined
                    : "Marks this notice as read"
              }
              onPress={() =>
                booking
                  ? onOpenBooking(n)
                  : docId && onOpenDoc
                    ? onOpenDoc(n, docId)
                    : onRead(n)
              }
              style={({ pressed }) => [
                s.row,
                !n.read && s.unread,
                pressed && { opacity: 0.7 },
              ]}
            >
              <View style={s.icon}>
                <Icon
                  name={(n.kind && ICONS[n.kind]) || "bell"}
                  size={16}
                  color={colors.accent}
                />
                {!n.read && <View style={s.dot} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.title, n.read && { color: colors.textSoft }]}>
                  {n.title}
                </Text>
                <Text style={s.body}>{n.body}</Text>
                <Text style={shared.small}>
                  {dateLabel(n.created_at)}
                  {n.via_agent ? ` · via ${n.via_agent}` : ""}
                  {booking
                    ? " · Tap to open"
                    : n.read
                      ? " · Read"
                      : " · Tap to mark read"}
                </Text>
              </View>
            </Pressable>
            {action && (
              <View style={[s.actions, !n.read && s.unread]}>
                <SmallAction
                  label={action.label}
                  disabled={busy}
                  onPress={() => action.run(n)}
                />
              </View>
            )}
          </FadeIn>
        );
      })}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    list: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      overflow: "hidden",
    },
    row: { flexDirection: "row", gap: 12, padding: 16 },
    mentions: { marginBottom: 12, gap: 2 },
    questions: { marginBottom: 12, gap: 2 },
    question: { gap: 3, paddingVertical: 10 },
    choices: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 },
    error: { color: colors.danger },
    mention: { gap: 3, paddingVertical: 10 },
    review: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      marginBottom: 12,
    },
    reviewTitle: {
      fontFamily: fonts.semibold,
      fontSize: 15,
      color: colors.text,
      marginBottom: 2,
    },
    actions: {
      flexDirection: "row",
      paddingLeft: 62,
      paddingRight: 16,
      paddingBottom: 14,
      marginTop: -6,
    },
    divider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    unread: { backgroundColor: colors.unread },
    icon: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: colors.accentSoft,
      alignItems: "center",
      justifyContent: "center",
    },
    dot: {
      position: "absolute",
      top: 0,
      right: 0,
      width: 9,
      height: 9,
      borderRadius: 5,
      backgroundColor: colors.highText,
      borderWidth: 1.5,
      borderColor: colors.surface,
    },
    title: {
      fontFamily: fonts.semibold,
      fontSize: 15,
      color: colors.text,
      marginBottom: 3,
    },
    body: {
      fontFamily: fonts.regular,
      fontSize: 15,
      lineHeight: 20,
      color: colors.textSoft,
      marginBottom: 6,
    },
  }),
);
