import { ProjectDraftReview } from "./ProjectDraftReview";
import React, { useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import {
  dateLabel,
  aiFeatureProviderLabel,
  describeRrule,
  parseRichText,
  type Action,
  type AssistantSource,
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
import { Pressable } from "../motion";
import { InlineDetails } from "./InlineDetails";
import { session } from "../lib/session";
import { usePaneWidth } from "../hooks/usePaneWidth";
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
  const { width, onLayout } = usePaneWidth();
  const { fontScale } = useWindowDimensions();
  const columnWidth = WIDE_COLUMN * Math.max(1, fontScale);
  const wide = header.length * columnWidth > width;
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
    <View style={[s.table, wide && { width: header.length * columnWidth }]}>
      {row(header, true, 0)}
      {rows.map((cells, r) => row(cells, false, r))}
    </View>
  );
  return (
    <View onLayout={onLayout} style={{ minWidth: 0 }}>
      {wide ? (
        <ScrollView
          horizontal
          tabIndex={0}
          showsHorizontalScrollIndicator
          accessibilityLabel="Table, scrolls sideways"
        >
          {grid}
        </ScrollView>
      ) : (
        grid
      )}
    </View>
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

/** Every configured reminder, in order; an empty list explicitly removes them. */
function reminderText(alerts: number[] | null | undefined) {
  if (!alerts?.length) return "No reminder";
  return [...alerts]
    .sort((a, b) => a - b)
    .map((minutes) =>
      minutes === 0 ? "At the start" : `${beforeText(minutes)} before`,
    )
    .join(", ");
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
  // Omitted reminders keep the saved value; legacy single reminders still count.
  const alerts =
    data.alerts ??
    (data.reminder_minutes !== undefined ? [data.reminder_minutes] : undefined);
  const previousAlerts =
    current.alerts ??
    (current.reminder_minutes !== undefined ? [current.reminder_minutes] : []);
  if (alerts && !sameAlerts(alerts, previousAlerts))
    lines.push(
      `Reminder: ${reminderText(previousAlerts)} → ${reminderText(alerts)}`,
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

function NoteDetails({ before, after }: { before?: string; after: string }) {
  return (
    <InlineDetails title={before === undefined ? "Notes" : "Notes change"}>
      {before !== undefined && (
        <>
          <Text style={s.sourcesLabel}>Before</Text>
          <ScrollView nestedScrollEnabled tabIndex={0} style={s.noteText}>
            <Text selectable style={shared.small}>
              {before || "Empty"}
            </Text>
          </ScrollView>
          <Text style={s.sourcesLabel}>After</Text>
        </>
      )}
      <ScrollView nestedScrollEnabled tabIndex={0} style={s.noteText}>
        <Text selectable style={shared.small}>
          {after || "Empty"}
        </Text>
      </ScrollView>
    </InlineDetails>
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
    return (
      <>
        {lines.length ? (
          <View style={{ gap: 3 }}>
            {lines.map((l) => (
              <Text key={l} style={s.diff}>
                {l}
              </Text>
            ))}
          </View>
        ) : (
          <Text style={shared.small}>No visible changes.</Text>
        )}
        {current.notes !== data.notes && (
          <NoteDetails before={current.notes} after={data.notes} />
        )}
      </>
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
      {data.due_at && (
        <Chip>
          {data.alerts !== undefined
            ? reminderText(data.alerts)
            : data.reminder_minutes !== undefined
              ? reminderText([data.reminder_minutes])
              : "Your default reminders"}
        </Chip>
      )}
      {data.team_id && <Chip>{teamName(items, data.team_id)}</Chip>}
      {!!data.notes && (
        <View style={{ flexBasis: "100%" }}>
          <NoteDetails after={data.notes} />
        </View>
      )}
    </View>
  );
}

/** One assistant reply: summary, proposed changes, and the approve/discard decision. */
export function ProposalReview(
  props: React.ComponentProps<typeof ProposalBody>,
) {
  return (
    <ProposalBody key={`${session.token}:${props.proposal.id}`} {...props} />
  );
}

function ProposalBody({
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
  onApprove: (giveTasksDeadlines?: boolean) => void;
  onDiscard: () => void;
  /** Sends a suggested quick reply; only the latest reply gets one. */
  onFollowUp?: (text: string) => void;
  /** Opens a page the assistant read, at the line it cited. */
  onOpenSource?: (source: AssistantSource) => void;
  /** Opens a note once it has been kept. */
  onKeptNote?: (docId: string) => void;
}) {
  const count = proposal.actions.length;
  const sessionChange = proposal.session_change;
  const total = count + Number(!!sessionChange);
  const [giveTasksDeadlines, setGiveTasksDeadlines] = useState(true);
  const status = state ?? (count || sessionChange ? "pending" : "info");
  const followUps = (proposal.follow_ups ?? []).filter((t) => t.trim());
  const sources = proposal.sources ?? [];
  const usedSources = sources.filter((source) => source.used);
  const otherSources = sources.filter((source) => !source.used);
  return (
    <View>
      <SummaryText text={proposal.summary} />
      {proposal.provider && (
        <Text style={s.providerCaption}>
          {aiFeatureProviderLabel(proposal.provider)}
        </Text>
      )}
      {/* What the assistant actually read, so the answer can be checked
          against it rather than taken on trust. */}
      {sources.length > 0 && (
        <InlineDetails title={`Sources (${sources.length})`}>
          <View style={s.sources}>
            {(
              [
                ["Used", usedSources],
                ["Also read", otherSources],
              ] as const
            ).map(([label, group]) =>
              group.length ? (
                <View key={label} style={s.sourceGroup}>
                  <Text style={s.sourcesLabel}>{label}</Text>
                  {group.map((source) => (
                    <SmallAction
                      key={
                        "doc_id" in source
                          ? `page:${source.doc_id}`
                          : `${source.kind}:${source.id}`
                      }
                      label={`[${source.number}] ${source.title || "Untitled"}`}
                      disabled={!onOpenSource}
                      onPress={() => onOpenSource?.(source)}
                    />
                  ))}
                </View>
              ) : null,
            )}
          </View>
        </InlineDetails>
      )}
      <DraftNotes
        scope={proposal.id}
        notes={proposal.notes ?? []}
        onKept={onKeptNote}
        report={() => {}}
      />
      {proposal.project && <ProjectDraftReview project={proposal.project} />}
      {proposal.project && status === "pending" && (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            minHeight: 44,
          }}
        >
          <Text style={[shared.body, { flex: 1, minWidth: 0 }]}>
            Give tasks these deadlines
          </Text>
          <Switch
            accessibilityLabel="Give tasks these deadlines"
            disabled={busy}
            value={giveTasksDeadlines}
            onValueChange={setGiveTasksDeadlines}
            trackColor={{ true: colors.accent }}
          />
        </View>
      )}
      {count > 0 && !proposal.project && (
        <View style={[s.actions, status === "discarded" && { opacity: 0.5 }]}>
          {proposal.actions.map((a, n) => {
            const op = OPERATION[a.operation];
            return (
              <View key={n} style={s.action}>
                <View style={s.actionHead}>
                  <View style={[s.op, { backgroundColor: op.bg }]}>
                    <Text style={[s.opText, { color: op.fg }]}>{op.label}</Text>
                  </View>
                  <Text style={s.actionTitle}>
                    {a.data?.title ||
                      before?.find((i) => i.id === a.item_id)?.title ||
                      items.find((i) => i.id === a.item_id)?.title ||
                      "An item in your planner"}
                  </Text>
                </View>
                <Details action={a} items={items} before={before} />
                {proposal.decision_links?.find(
                  (link) => link.action_index === n,
                ) && (
                  <Text style={shared.body}>
                    Delivers decision:{" "}
                    {
                      proposal.decision_links.find(
                        (link) => link.action_index === n,
                      )?.decision_title
                    }
                  </Text>
                )}
              </View>
            );
          })}
        </View>
      )}
      {sessionChange && (
        <View style={s.action}>
          <Text style={s.actionTitle}>
            {sessionChange.operation === "move" ? "Move" : "Remove"} session ·{" "}
            {sessionChange.title}
          </Text>
          <Text style={shared.body}>
            {new Date(sessionChange.from_start_at).toLocaleString()}–
            {new Date(sessionChange.from_end_at).toLocaleTimeString()}
            {sessionChange.operation === "move"
              ? ` → ${new Date(sessionChange.start_at).toLocaleString()}–${new Date(sessionChange.end_at).toLocaleTimeString()}`
              : ""}
          </Text>
        </View>
      )}
      {status === "pending" && (
        <View style={s.buttons}>
          <Button
            title={
              proposal.project
                ? "Create project and schedule"
                : `Approve ${total} ${total === 1 ? "change" : "changes"}`
            }
            icon="check"
            disabled={busy}
            onPress={() => onApprove(giveTasksDeadlines)}
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
      {status === "applied" && total > 0 && (
        <View style={s.status}>
          <Icon
            name="check"
            size={14}
            color={colors.accent}
            strokeWidth={2.4}
          />
          <Text style={[s.statusText, { color: colors.accent }]}>
            Saved to your planner
          </Text>
        </View>
      )}
      {status === "discarded" && (
        <View style={s.status}>
          <Icon name="x" size={14} color={colors.muted} />
          <Text style={s.statusText}>Discarded</Text>
        </View>
      )}
      {onFollowUp && followUps.length > 0 && (
        <View style={s.followUps}>
          {followUps.map((text, n) => (
            <Pressable
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
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    summary: { gap: 8 },
    sources: {
      gap: 6,
      marginTop: 6,
    },
    sourceGroup: {
      flexDirection: "row",
      alignItems: "center",
      flexWrap: "wrap",
      gap: 6,
    },
    providerCaption: {
      fontFamily: fonts.regular,
      fontSize: 13,
      color: colors.muted,
      marginBottom: 8,
    },
    sourcesLabel: { color: colors.muted, fontSize: 13 },
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
    bulletText: { flex: 1, minWidth: 0 },
    bulletDot: {
      fontFamily: fonts.bold,
      fontSize: 15,
      lineHeight: 21,
      color: colors.accent,
    },
    actions: { gap: 8, marginTop: 12 },
    action: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
      paddingVertical: 12,
      gap: 8,
    },
    actionHead: { flexDirection: "row", alignItems: "center", gap: 8 },
    op: { borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 3 },
    opText: { fontFamily: fonts.semibold, fontSize: 13 },
    actionTitle: {
      flex: 1,
      minWidth: 0,
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
      fontSize: 13,
      color: colors.textSoft,
    },
    noteText: { maxHeight: 240 },
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
      minHeight: 44,
      justifyContent: "center",
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
      fontSize: 13,
      color: colors.accent,
    },
  }),
);
