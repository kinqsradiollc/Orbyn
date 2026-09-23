import { ProjectDraftReview } from "./ProjectDraftReview";
import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import {
  dateLabel,
  describeRrule,
  parseRichText,
  type Action,
  type DocSource,
  type RichInline,
  type Item,
  type ItemInput,
  type Proposal,
} from "@orbyn/core";
import { Button } from "./Button";
import { SmallAction } from "./SmallAction";
import { DraftNotes } from "./DraftNotes";
import { Icon } from "./Icon";
import type { TurnState } from "../hooks/useAssistant";
import { FadeIn, PressableScale } from "../motion";
import { colors, fonts, radii, themed } from "../theme";
import { shared } from "../styles";

const OPERATION = themed(() => ({
  create: { label: "New", bg: colors.accentSoft, fg: colors.accent },
  update: { label: "Update", bg: colors.mediumBg, fg: colors.mediumText },
  delete: { label: "Delete", bg: colors.dangerSoft, fg: colors.danger },
}));

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

const plainText = (parts: RichInline[]) => parts.map((p) => p.text).join("");

/** Column width once a table has too many columns to fit and scrolls sideways. */
const WIDE_COLUMN = 128;

/** A Markdown table as a bordered grid of equal-width cells. */
function Table({
  header,
  rows,
}: {
  header: RichInline[][];
  rows: RichInline[][][];
}) {
  const columns = header.map(plainText);
  const wide = header.length > 3;
  const row = (cells: RichInline[][], head: boolean, r: number) => (
    <View
      key={head ? "head" : r}
      style={[s.tableRow, head ? s.tableHead : r % 2 === 1 && s.tableZebra]}
      accessible
      accessibilityRole={head ? "header" : undefined}
      accessibilityLabel={
        head
          ? `Table columns: ${columns.join(", ")}`
          : `Row ${r + 1}: ` +
            cells
              .map(
                (cell, c) =>
                  `${columns[c] || `Column ${c + 1}`}: ${plainText(cell)}`,
              )
              .join(", ")
      }
    >
      {cells.map((cell, c) => (
        <View key={c} style={[s.tableCell, c > 0 && s.tableDivider]}>
          <Text style={[s.tableText, head && s.tableHeadText]}>
            <Inlines parts={cell} />
          </Text>
        </View>
      ))}
    </View>
  );
  const grid = (
    <View style={[s.table, wide && { width: header.length * WIDE_COLUMN }]}>
      {row(header, true, 0)}
      {rows.map((cells, r) => row(cells, false, r))}
    </View>
  );
  return wide ? (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator
      accessibilityLabel="Table, scrolls sideways"
    >
      {grid}
    </ScrollView>
  ) : (
    grid
  );
}

/** The reply as headings, paragraphs, lists and tables (shared parser with web). */
function SummaryText({ text }: { text: string }) {
  return (
    <View style={s.summary}>
      {parseRichText(text).map((block, n) =>
        block.type === "heading" ? (
          <Text key={n} style={s.heading} accessibilityRole="header">
            <Inlines parts={block.inlines} />
          </Text>
        ) : block.type === "table" ? (
          <Table key={n} header={block.header} rows={block.rows} />
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

/** "30 min", "2 hours", "1 day", or "1 h 30 min" for minutes before. */
function beforeText(m: number) {
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  if (m < 60) return `${m} min`;
  if (m % 1440 === 0) return unit(m / 1440, "day");
  if (m % 60 === 0) return unit(m / 60, "hour");
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** The soonest alert: "Remind 30 min before", or "No reminder" without any. */
function reminderText(alerts: number[] | null | undefined) {
  if (!alerts?.length) return "No reminder";
  const soonest = Math.min(...alerts);
  return soonest === 0
    ? "Remind when it starts"
    : `Remind ${beforeText(soonest)} before`;
}

const sameAlerts = (a: number[], b: number[]) => {
  const x = [...a].sort((p, q) => p - q);
  const y = [...b].sort((p, q) => p - q);
  return x.length === y.length && x.every((v, n) => v === y[n]);
};

function changes(data: ItemInput, current: Item, items: Item[]) {
  const lines: string[] = [];
  const compare = (label: string, before: string, after: string) => {
    if (before !== after) lines.push(`${label}: ${before} → ${after}`);
  };
  compare("Title", current.title, data.title);
  compare("Due", dateLabel(current.due_at), dateLabel(data.due_at));
  if (current.end_at || data.end_at)
    compare("Ends", dateLabel(current.end_at), dateLabel(data.end_at));
  if (data.rrule !== undefined)
    compare(
      "Repeats",
      describeRrule(current.rrule) || "Doesn't repeat",
      describeRrule(data.rrule) || "Doesn't repeat",
    );
  compare("Priority", current.priority, data.priority);
  compare("Status", current.status, data.status);
  compare("Type", current.kind, data.kind);
  // Only when the proposal actually changes the alerts.
  if (data.alerts && !sameAlerts(data.alerts, current.alerts ?? []))
    lines.push(
      `Reminder: ${reminderText(current.alerts)} → ${reminderText(data.alerts)}`,
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
      {!!data.rrule && <Chip>{describeRrule(data.rrule)}</Chip>}
      <Chip
        high={data.priority === "high"}
      >{`${capitalize(data.priority)} priority`}</Chip>
      {data.due_at && data.alerts && <Chip>{reminderText(data.alerts)}</Chip>}
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
  onFollowUp,
  onOpenSource,
  onKeptNote,
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
  /** Sends a suggested quick reply; only the latest reply gets one. */
  onFollowUp?: (text: string) => void;
  /** Opens a page the assistant read, at the line it cited. */
  onOpenSource?: (source: DocSource) => void;
  /** Opens a note once it has been kept. */
  onKeptNote?: (docId: string) => void;
}) {
  const count = proposal.actions.length;
  const status = state ?? (count ? "pending" : "info");
  const followUps = (proposal.follow_ups ?? []).filter((t) => t.trim());
  const sources = proposal.sources ?? [];
  return (
    <View>
      <SummaryText text={proposal.summary} />
      {/* What the assistant actually read, so the answer can be checked
          against it rather than taken on trust. */}
      {sources.length > 0 && (
        <View style={s.sources}>
          <Text style={s.sourcesLabel}>READ</Text>
          {sources.map((source) => (
            <SmallAction
              key={source.doc_id + (source.block_id ?? "")}
              label={source.title || "Untitled"}
              disabled={!onOpenSource}
              onPress={() => onOpenSource?.(source)}
            />
          ))}
        </View>
      )}
      <DraftNotes
        notes={proposal.notes ?? []}
        onKept={onKeptNote}
        report={() => {}}
      />
      {proposal.project && <ProjectDraftReview project={proposal.project} />}
      {count > 0 && !proposal.project && (
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
            title={
              proposal.project
                ? "Create project and schedule"
                : `Approve ${count} ${count === 1 ? "change" : "changes"}`
            }
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
      {onFollowUp && followUps.length > 0 && (
        <FadeIn style={s.followUps}>
          {followUps.map((text, n) => (
            <PressableScale
              key={n}
              accessibilityRole="button"
              accessibilityLabel={text}
              accessibilityHint="Sends this as your next message"
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              onPress={() => onFollowUp(text)}
              style={({ pressed }) => [
                s.followUp,
                pressed && s.followUpPressed,
                busy && { opacity: 0.5 },
              ]}
            >
              <Text style={s.followUpText}>{text}</Text>
            </PressableScale>
          ))}
        </FadeIn>
      )}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    summary: { gap: 8 },
    sources: {
      flexDirection: "row",
      alignItems: "center",
      flexWrap: "wrap",
      gap: 6,
      marginTop: 6,
    },
    sourcesLabel: { color: colors.muted, fontSize: 10, letterSpacing: 0.7 },
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
      maxWidth: "100%",
      backgroundColor: colors.surfaceMuted,
      borderRadius: radii.pill,
      paddingHorizontal: 9,
      paddingVertical: 4,
    },
    chipText: {
      flexShrink: 1,
      fontFamily: fonts.medium,
      fontSize: 12,
      color: colors.textSoft,
    },
    notes: { flexBasis: "100%", marginTop: 2 },
    diff: { fontFamily: fonts.regular, fontSize: 13, color: colors.textSoft },
    buttons: { marginTop: 12 },
    status: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      marginTop: 12,
    },
    statusText: {
      fontFamily: fonts.semibold,
      fontSize: 13,
      color: colors.muted,
    },
    table: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.input,
      overflow: "hidden",
      backgroundColor: colors.background,
    },
    tableRow: {
      flexDirection: "row",
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    tableHead: { borderTopWidth: 0, backgroundColor: colors.surfaceMuted },
    tableZebra: { backgroundColor: colors.surface },
    tableCell: { flex: 1, paddingHorizontal: 8, paddingVertical: 6 },
    tableDivider: { borderLeftWidth: 1, borderLeftColor: colors.border },
    tableText: {
      fontFamily: fonts.regular,
      fontSize: 13,
      lineHeight: 18,
      color: colors.textSoft,
    },
    tableHeadText: { fontFamily: fonts.semibold, color: colors.text },
    followUps: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 6,
      marginTop: 12,
    },
    followUp: {
      maxWidth: "100%",
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.softBorder,
      borderRadius: radii.pill,
      paddingHorizontal: 12,
      paddingVertical: 7,
    },
    followUpPressed: { backgroundColor: colors.accentSoft },
    followUpText: {
      flexShrink: 1,
      fontFamily: fonts.medium,
      fontSize: 12,
      color: colors.accent,
    },
  }),
);
