import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { dateLabel, type Notice } from "@orbyn/core";
import { Icon, type IconName } from "../components/Icon";
import { SmallAction } from "../components/SmallAction";
import { AsksList } from "../components/followthrough/Asks";
import { FadeIn } from "../motion";
import { colors, fonts, radii, themed } from "../theme";
import { shared } from "../styles";

const ICONS: Partial<Record<NonNullable<Notice["kind"]>, IconName>> = {
  conflict: "alert",
  booking: "calendar",
  rollforward: "arrowRight",
  at_risk: "alert",
  deadline: "clock",
  rsvp: "users",
  template: "layoutGrid",
};

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
  onOpenItemById,
  onOpenDoc,
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
  /** Open a task an ask is about. */
  onOpenItemById?: (itemId: string) => void;
  /** Open the page an "import" notice is about (`ref` = "doc:<id>"). */
  onOpenDoc?: (notice: Notice, docId: string) => void;
}) {
  const asks = onOpenItemById ? <AsksList onOpenItem={onOpenItemById} /> : null;
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
          n.kind === "import" && n.ref?.startsWith("doc:")
            ? n.ref.slice(4).split(":")[0]
            : null;
        const action =
          n.kind === "conflict" && n.ref
            ? { label: "Reschedule", run: onReschedule }
            : n.kind === "rollforward"
              ? { label: "Roll forward", run: onRollForward }
              : n.kind === "at_risk" || n.kind === "deadline"
                ? { label: "Plan it", run: onPlanIt }
                : n.kind === "rsvp" && n.item_id
                  ? { label: "Open event", run: onOpenItem }
                  : n.kind === "template" && n.ref && onOpenTemplate
                    ? { label: "Review", run: onOpenTemplate }
                    : docId && onOpenDoc
                      ? {
                          label: "Open page",
                          run: (x: Notice) => onOpenDoc(x, docId),
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
      fontSize: 14,
      lineHeight: 20,
      color: colors.textSoft,
      marginBottom: 6,
    },
  }),
);
