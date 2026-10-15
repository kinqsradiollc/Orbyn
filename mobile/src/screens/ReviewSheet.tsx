import React, { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import type { ReviewInbox, ReviewItem } from "@orbyn/core";
import { Button } from "../components/Button";
import { ErrorBanner } from "../components/ErrorBanner";
import { Icon } from "../components/Icon";
import { Pill } from "../components/Pill";
import { Sheet, sheetStyles } from "../components/Sheet";
import { client } from "../lib/api";
import { confirmAction } from "../lib/confirm";
import { errorText } from "../lib/errors";
import { onLive } from "../lib/live";
import { timeAgo } from "../lib/progress";
import { Pressable } from "../motion";
import { colors, fonts, radii, themed } from "../theme";
import { shared } from "../styles";

const STATUS: Record<ReviewItem["status"], string> = {
  pending: "Waiting",
  applied: "Approved",
  declined: "Declined",
  cancelled: "Cancelled",
  expired: "Expired",
};

/** "expires in 2 days". */
function expiresIn(iso: string) {
  const ms = Date.parse(iso) - Date.now();
  if (ms <= 0) return "expired";
  const min = Math.round(ms / 60_000);
  if (min < 60) return `expires in ${min} min`;
  const h = Math.round(min / 60);
  return h < 48 ? `expires in ${h} h` : `expires in ${Math.round(h / 24)} days`;
}

/**
 * Review, on the phone: what connected agents and the assistant suggest,
 * waiting for you. Each change shows before and after and whether the
 * thing changed since; approve all, some, or decline. Opened from the
 * Settings menu, a "waits for review" notice, or an /app/review/<id> link.
 */
export function ReviewSheet({
  visible,
  focusId,
  onFocused,
  onCount,
  onClose,
  onDismiss,
}: {
  visible: boolean;
  focusId: string | null;
  onFocused: () => void;
  onCount?: (pending: number) => void;
  onClose: () => void;
  onDismiss?: () => void;
}) {
  const [inbox, setInbox] = useState<ReviewInbox | null>(null);
  const [open, setOpen] = useState<ReviewItem | null>(null);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const active = useRef(visible);
  active.current = visible;
  const listEpoch = useRef(0);
  const detailEpoch = useRef(0);
  const selected = useRef<string | null>(null);
  const mutation = useRef(false);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [readFailure, setReadFailure] = useState<"list" | "detail" | null>(
    null,
  );
  const [detailPending, setDetailPending] = useState(false);
  const countRef = useRef(onCount);
  countRef.current = onCount;
  const load = async () => {
    const epoch = ++listEpoch.current;
    try {
      const next = await client.reviewInbox();
      if (!active.current || epoch !== listEpoch.current) return;
      setInbox(next);
      countRef.current?.(next.pending.length);
      setReadFailure((value) => (value === "list" ? null : value));
    } catch (error) {
      if (active.current && epoch === listEpoch.current) {
        setError(errorText(error));
        setReadFailure("list");
      }
    }
  };
  const show = async (id: string) => {
    const epoch = ++detailEpoch.current;
    if (selected.current !== id) {
      setOpen(null);
      setDone("");
    }
    selected.current = id;
    setTargetId(id);
    setDetailPending(true);
    setReadFailure(null);
    setError("");
    try {
      const item = await client.reviewItem(id);
      if (
        !active.current ||
        epoch !== detailEpoch.current ||
        selected.current !== id
      )
        return;
      setOpen(item);
      setChosen(new Set(item.changes.map((change) => change.index)));
    } catch (error) {
      if (active.current && epoch === detailEpoch.current) {
        setError(errorText(error));
        setReadFailure("detail");
      }
    } finally {
      if (active.current && epoch === detailEpoch.current)
        setDetailPending(false);
    }
  };

  useEffect(() => {
    if (!visible) return;
    active.current = true;
    setDone("");
    setError("");
    setInbox(null);
    setOpen(null);
    setTargetId(null);
    selected.current = null;
    void load();
    const stop = onLive((news) => {
      if (news.kind !== "changed" || (news.area && news.area !== "review"))
        return;
      void load();
      if (selected.current && !mutation.current) void show(selected.current);
    });
    return () => {
      active.current = false;
      listEpoch.current++;
      detailEpoch.current++;
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (!visible || !focusId || mutation.current) return;
    void show(focusId);
    onFocused();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, focusId]);

  const act = async (fn: () => Promise<string>) => {
    if (
      mutation.current ||
      !active.current ||
      detailPending ||
      readFailure === "detail"
    )
      return;
    mutation.current = true;
    setBusy(true);
    setError("");
    try {
      const message = await fn();
      if (active.current) setDone(message);
    } catch (error) {
      if (active.current) setError(errorText(error));
    } finally {
      mutation.current = false;
      if (active.current) setBusy(false);
    }
  };

  const approve = (item: ReviewItem) => {
    if (
      selected.current !== item.id ||
      item.status !== "pending" ||
      !chosen.size ||
      item.changes.some(
        (c) => c.stale && (!item.partial || chosen.has(c.index)),
      )
    )
      return;
    return act(async () => {
      const only =
        item.partial && chosen.size < item.changes.length
          ? [...chosen]
          : undefined;
      await client.approveReview(item.id, only ? { only } : {});
      await Promise.all([load(), show(item.id)]);
      return only
        ? `Approved ${only.length} of ${item.changes.length} changes.`
        : "Changes approved.";
    });
  };

  const decline = (item: ReviewItem) =>
    confirmAction(
      `Decline what ${item.proposer} suggests?`,
      "Nothing changes, and it leaves your inbox.",
      "Decline",
      () =>
        void act(async () => {
          await client.declineReview(item.id);
          await Promise.all([load(), show(item.id)]);
          return "Suggestion declined.";
        }),
    );

  const row = (item: ReviewItem) => (
    <Pressable
      key={item.id}
      accessibilityRole="button"
      disabled={busy}
      onPress={() => void show(item.id)}
      style={s.card}
    >
      <View style={s.cardIcon}>
        <Icon
          name={item.source === "assistant" ? "sparkles" : "inbox"}
          size={16}
          color={colors.accent}
        />
      </View>
      <View style={s.flex}>
        <Text style={s.cardTitle}>{item.summary}</Text>
        <Text style={shared.small}>
          {item.kind === "idea" ? "Idea · " : ""}
          {item.proposer} · {item.changes.length} change
          {item.changes.length === 1 ? "" : "s"} ·{" "}
          {item.status === "pending"
            ? expiresIn(item.expires_at)
            : `${STATUS[item.status]} ${timeAgo(item.decided_at ?? item.expires_at)}`}
        </Text>
      </View>
    </Pressable>
  );

  const chosenStale =
    open?.changes.some((c) => c.stale && chosen.has(c.index)) ?? false;

  return (
    <Sheet
      visible={visible}
      title={targetId ? "Suggested changes" : "Review"}
      onClose={() => {
        if (mutation.current) return;
        selected.current = null;
        detailEpoch.current++;
        setTargetId(null);
        setOpen(null);
        onClose();
      }}
      onBack={
        targetId
          ? () => {
              if (mutation.current) return;
              selected.current = null;
              detailEpoch.current++;
              setTargetId(null);
              setReadFailure(null);
              setError("");
              setDetailPending(false);
              setOpen(null);
              setDone("");
            }
          : undefined
      }
      onDismiss={onDismiss}
    >
      <ScrollView contentContainerStyle={sheetStyles.body}>
        {!!error && (
          <ErrorBanner error={error} onDismiss={() => setError("")} />
        )}
        {readFailure && (
          <Button
            title="Retry"
            secondary
            disabled={busy || detailPending}
            onPress={() => {
              if (readFailure === "detail" && selected.current)
                void show(selected.current);
              else void load();
            }}
          />
        )}
        {detailPending && (
          <Text style={shared.small} accessibilityLiveRegion="polite">
            Loading changes…
          </Text>
        )}
        {!open ? (
          targetId ? null : !inbox ? (
            readFailure === "list" ? null : (
              <Text style={shared.small}>Loading…</Text>
            )
          ) : (
            <View>
              {inbox.pending.length ? (
                <View style={s.list}>{inbox.pending.map(row)}</View>
              ) : (
                <View style={s.empty}>
                  <Icon name="inbox" size={28} color={colors.muted} />
                  <Text style={shared.sectionTitle}>
                    No pending suggestions
                  </Text>
                  <Text style={[shared.small, s.center]}>
                    Agent changes that need approval appear here.
                  </Text>
                </View>
              )}
              {inbox.recent.length > 0 && (
                <>
                  <Text style={[shared.label, s.heading]}>
                    Recent decisions
                  </Text>
                  <View style={s.list}>{inbox.recent.map(row)}</View>
                </>
              )}
            </View>
          )
        ) : (
          <View>
            <Text style={shared.small}>
              {open.proposer} · {STATUS[open.status]}
            </Text>
            <Text style={s.title}>{open.summary}</Text>
            <Text style={[shared.small, s.gap]}>
              Suggested {timeAgo(open.created_at)}
              {open.status === "pending" && ` · ${expiresIn(open.expires_at)}`}
            </Text>
            <View style={s.list}>
              {open.changes.map((c) => (
                <View
                  key={c.index}
                  style={[s.change, c.stale && s.staleChange]}
                >
                  <View style={s.changeHead}>
                    {open.partial && open.status === "pending" && (
                      <Switch
                        accessibilityLabel={`Include: ${c.headline}`}
                        value={chosen.has(c.index)}
                        disabled={
                          busy || detailPending || readFailure === "detail"
                        }
                        onValueChange={(on) =>
                          setChosen((now) => {
                            const next = new Set(now);
                            if (on) next.add(c.index);
                            else next.delete(c.index);
                            return next;
                          })
                        }
                        trackColor={{
                          true: colors.accent,
                          false: colors.border,
                        }}
                      />
                    )}
                    <Text style={[s.changeTitle, s.changeText]}>
                      {c.headline}
                    </Text>
                    <Pill label={c.space} />
                  </View>
                  {c.rows.map((r, i) => (
                    <View key={i} style={s.row}>
                      {!!r.label && <Text style={s.rowLabel}>{r.label}</Text>}
                      <View style={s.flex}>
                        {r.before !== null && (
                          <Text style={s.before}>{r.before}</Text>
                        )}
                        {r.after !== null && (
                          <Text style={s.after}>{r.after}</Text>
                        )}
                      </View>
                    </View>
                  ))}
                  {c.emails.length > 0 && (
                    <Text style={shared.small}>
                      Emails {c.emails.join(", ")}
                    </Text>
                  )}
                  {c.stale && <Text style={s.stale}>{c.stale_reason}</Text>}
                </View>
              ))}
            </View>
            {open.status === "pending" && (
              <View style={s.actions}>
                <Button
                  title="Decline"
                  secondary
                  disabled={busy || detailPending || readFailure === "detail"}
                  onPress={() => decline(open)}
                  style={s.actionButton}
                />
                <Button
                  title={
                    open.partial && chosen.size < open.changes.length
                      ? `Approve ${chosen.size} of ${open.changes.length}`
                      : "Approve"
                  }
                  icon="check"
                  disabled={
                    busy ||
                    detailPending ||
                    readFailure === "detail" ||
                    chosen.size === 0 ||
                    chosenStale ||
                    (!open.partial && open.changes.some((c) => c.stale))
                  }
                  onPress={() => void approve(open)}
                  style={s.actionButton}
                />
              </View>
            )}
            {chosenStale && open.status === "pending" && (
              <Text style={[shared.small, s.gap]}>
                Some changes are stale. Omit them, or decline and ask again.
              </Text>
            )}
            {!!done && <Text style={s.done}>{done}</Text>}
          </View>
        )}
      </ScrollView>
    </Sheet>
  );
}

const s = themed(() =>
  StyleSheet.create({
    flex: { flexGrow: 1, flexBasis: 140, minWidth: 0 },
    list: { gap: 8 },
    heading: { marginTop: 20 },
    center: { textAlign: "center" },
    gap: { marginBottom: 14 },
    empty: { alignItems: "center", gap: 8, paddingVertical: 24 },
    card: {
      flexDirection: "row",
      gap: 12,
      padding: 12,
      borderRadius: radii.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    cardIcon: {
      width: 30,
      height: 30,
      borderRadius: radii.input,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.accentSoft,
    },
    cardTitle: {
      fontFamily: fonts.semibold,
      fontSize: 15,
      color: colors.text,
      marginBottom: 2,
    },
    title: {
      fontFamily: fonts.display,
      fontSize: 18,
      color: colors.text,
      marginBottom: 4,
    },
    change: {
      paddingVertical: 14,
      gap: 6,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
    },
    staleChange: {
      paddingLeft: 12,
      borderLeftWidth: 2,
      borderLeftColor: colors.warning,
    },
    changeHead: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      alignItems: "center",
    },
    changeText: { flexGrow: 1, flexBasis: 140, minWidth: 0 },
    changeTitle: {
      fontFamily: fonts.semibold,
      fontSize: 13,
      color: colors.text,
    },
    row: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    rowLabel: {
      width: 84,
      fontFamily: fonts.medium,
      fontSize: 13,
      color: colors.muted,
    },
    before: {
      fontFamily: fonts.regular,
      fontSize: 13,
      color: colors.muted,
      textDecorationLine: "line-through",
    },
    after: { fontFamily: fonts.regular, fontSize: 13, color: colors.text },
    stale: {
      fontFamily: fonts.regular,
      fontSize: 13,
      color: colors.text,
      backgroundColor: colors.warningSoft,
      borderRadius: radii.input,
      padding: 8,
    },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 16 },
    actionButton: { flexGrow: 1, flexBasis: 140, minWidth: 0 },
    done: {
      fontFamily: fonts.medium,
      fontSize: 13,
      color: colors.accent,
      marginTop: 10,
    },
  }),
);
