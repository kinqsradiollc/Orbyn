import React from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  dateLabel,
  parseRichText,
  type Action,
  type RichInline,
  type Item,
  type ItemInput,
  type Proposal,
} from "@orbyn/core";
import { Button } from "./Button";
import { Icon } from "./Icon";
import type { TurnState } from "../hooks/useAssistant";
import { FadeIn } from "../motion";
import { colors, fonts, radii } from "../theme";
import { shared } from "../styles";

const OPERATION = {
  create: { label: "New", bg: colors.accentSoft, fg: colors.accent },
  update: { label: "Update", bg: colors.mediumBg, fg: colors.mediumText },
  delete: { label: "Delete", bg: colors.dangerSoft, fg: colors.danger },
} as const;

function Inlines({ parts }: { parts: RichInline[] }) {
  return (
    <>
      {parts.map((part, n) => (
        <Text
          key={n}
          style={[
            part.bold && s.bold,
            part.italic && s.italic,
            part.code && s.code,
          ]}
        >
          {part.text}
        </Text>
      ))}
    </>
  );
}

/** The reply as headings, paragraphs and lists (shared parser with web). */
function SummaryText({ text }: { text: string }) {
  return (
    <View style={s.summary}>
      {parseRichText(text).map((block, n) =>
        block.type === "heading" ? (
          <Text key={n} style={s.heading} accessibilityRole="header">
            <Inlines parts={block.inlines} />
          </Text>
        ) : block.type === "list" ? (
          <View key={n} style={s.list}>
            {block.items.map((item, m) => (
              <View key={m} style={s.bulletRow}>
                <Text style={s.bulletDot}>
                  {block.ordered ? `${m + 1}.` : "•"}
                </Text>
                <Text style={[shared.body, s.bulletText]}>
                  <Inlines parts={item} />
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <Text key={n} style={shared.body}>
            <Inlines parts={block.inlines} />
          </Text>
        ),
      )}
    </View>
  );
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const teamName = (items: Item[], teamId: string | null) =>
  teamId
    ? items.find((i) => i.team_id === teamId && i.team_name)?.team_name ||
      "A team"
    : "Personal";

function changes(data: ItemInput, current: Item, items: Item[]) {
  const lines: string[] = [];
  const compare = (label: string, before: string, after: string) => {
    if (before !== after) lines.push(`${label}: ${before} → ${after}`);
  };
  compare("Title", current.title, data.title);
  compare("Due", dateLabel(current.due_at), dateLabel(data.due_at));
  if (current.end_at || data.end_at)
    compare("Ends", dateLabel(current.end_at), dateLabel(data.end_at));
  compare("Priority", current.priority, data.priority);
  compare("Status", current.status, data.status);
  compare("Type", current.kind, data.kind);
  compare(
    "Reminder",
    `${current.reminder_minutes} min`,
    `${data.reminder_minutes} min`,
  );
  compare(
    "Shared with",
    teamName(items, current.team_id),
    teamName(items, data.team_id),
  );
  if (current.notes !== data.notes) lines.push("Notes updated");
  return lines;
}

function Chip({ children, high }: { children: string; high?: boolean }) {
  return (
    <View style={[s.chip, high && { backgroundColor: colors.highBg }]}>
      <Text style={[s.chipText, high && { color: colors.highText }]}>
        {children}
      </Text>
    </View>
  );
}

function Details({
  action,
  items,
  before,
}: {
  action: Action;
  items: Item[];
  before?: Item[];
}) {
  const data = action.data;
  const current =
    before?.find((i) => i.id === action.item_id) ??
    items.find((i) => i.id === action.item_id);
  if (action.operation === "delete")
    return (
      <Text style={shared.small}>Removes this item from your planner.</Text>
    );
  if (!data) return null;
  if (action.operation === "update" && current) {
    const lines = changes(data, current, items);
    return lines.length ? (
      <View style={{ gap: 3 }}>
        {lines.map((l) => (
          <Text key={l} style={s.diff}>
            {l}
          </Text>
        ))}
      </View>
    ) : (
      <Text style={shared.small}>No visible changes.</Text>
    );
  }
  return (
    <View style={s.chips}>
      <Chip>
        {dateLabel(data.due_at) +
          (data.end_at ? ` → ${dateLabel(data.end_at)}` : "")}
      </Chip>
      <Chip
        high={data.priority === "high"}
      >{`${capitalize(data.priority)} priority`}</Chip>
      {data.due_at && (
        <Chip>{`Remind ${data.reminder_minutes} min before`}</Chip>
      )}
      {data.team_id && <Chip>{teamName(items, data.team_id)}</Chip>}
      {!!data.notes && (
        <Text style={[shared.small, s.notes]}>{data.notes}</Text>
      )}
    </View>
  );
}

/** One assistant reply: summary, proposed changes, and the approve/discard decision. */
export function ProposalReview({
  proposal,
  items,
  before,
  busy,
  state,
  onApprove,
  onDiscard,
}: {
  proposal: Proposal;
  /** Current planner items, used to name items an action refers to by id. */
  items: Item[];
  /** Items as they were when the reply arrived; diffs use these first. */
  before?: Item[];
  busy: boolean;
  /** Defaults to "pending" when the reply proposes changes, otherwise "info". */
  state?: TurnState;
  onApprove: () => void;
  onDiscard: () => void;
}) {
  const count = proposal.actions.length;
  const status = state ?? (count ? "pending" : "info");
  return (
    <View>
      <SummaryText text={proposal.summary} />
      {count > 0 && (
        <View style={[s.actions, status === "discarded" && { opacity: 0.5 }]}>
          {proposal.actions.map((a, n) => {
            const op = OPERATION[a.operation];
            return (
              <FadeIn key={n} index={n} style={s.action}>
                <View style={s.actionHead}>
                  <View style={[s.op, { backgroundColor: op.bg }]}>
                    <Text style={[s.opText, { color: op.fg }]}>{op.label}</Text>
                  </View>
                  <Text style={s.actionTitle} numberOfLines={2}>
                    {a.data?.title ||
                      before?.find((i) => i.id === a.item_id)?.title ||
                      items.find((i) => i.id === a.item_id)?.title ||
                      "An item in your planner"}
                  </Text>
                </View>
                <Details action={a} items={items} before={before} />
              </FadeIn>
            );
          })}
        </View>
      )}
      {status === "pending" && (
        <View style={s.buttons}>
          <Button
            title={`Approve ${count} ${count === 1 ? "change" : "changes"}`}
            icon="check"
            disabled={busy}
            onPress={onApprove}
          />
          <Button
            secondary
            title="Discard"
            disabled={busy}
            onPress={onDiscard}
            style={{ marginBottom: 0 }}
          />
        </View>
      )}
      {status === "applied" && count > 0 && (
        <FadeIn style={s.status}>
          <Icon
            name="check"
            size={14}
            color={colors.accent}
            strokeWidth={2.4}
          />
          <Text style={[s.statusText, { color: colors.accent }]}>
            Saved to your planner
          </Text>
        </FadeIn>
      )}
      {status === "discarded" && (
        <FadeIn style={s.status}>
          <Icon name="x" size={14} color={colors.muted} />
          <Text style={s.statusText}>Discarded</Text>
        </FadeIn>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  summary: { gap: 8 },
  heading: {
    fontFamily: fonts.bold,
    fontSize: 15,
    lineHeight: 21,
    color: colors.text,
    marginTop: 4,
  },
  bold: { fontFamily: fonts.semibold, color: colors.text },
  italic: { fontStyle: "italic" },
  code: {
    fontFamily: "Menlo",
    fontSize: 13,
    backgroundColor: colors.surfaceMuted,
  },
  list: { gap: 6 },
  bulletRow: { flexDirection: "row", gap: 8 },
  bulletText: { flex: 1 },
  bulletDot: {
    fontFamily: fonts.bold,
    fontSize: 14,
    lineHeight: 21,
    color: colors.accent,
  },
  actions: { gap: 8, marginTop: 12 },
  action: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.input,
    padding: 12,
    gap: 8,
  },
  actionHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  op: { borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 3 },
  opText: { fontFamily: fonts.semibold, fontSize: 11 },
  actionTitle: {
    flex: 1,
    fontFamily: fonts.semibold,
    fontSize: 15,
    color: colors.text,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.pill,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  chipText: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: colors.textSoft,
  },
  notes: { flexBasis: "100%", marginTop: 2 },
  diff: { fontFamily: fonts.regular, fontSize: 13, color: colors.textSoft },
  buttons: { marginTop: 12 },
  status: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12 },
  statusText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.muted },
});
