import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type {
  Booking,
  BookingPage,
  BookingStats,
  BookingView,
} from "@orbyn/core";
import { Button } from "../../components/Button";
import { Chip, ChipRow } from "../../components/Chip";
import { ErrorBanner } from "../../components/ErrorBanner";
import { Icon } from "../../components/Icon";
import { Pill } from "../../components/Pill";
import { Segmented } from "../../components/Segmented";
import { sheetStyles } from "../../components/Sheet";
import { SmallAction } from "../../components/SmallAction";
import { client } from "../../lib/api";
import { minutesLabel, shareText, slotLabel } from "../../lib/planning";
import { useRun } from "../../hooks/useRun";
import { FadeIn, animateLayout } from "../../motion";
import { colors, fonts, radii } from "../../theme";
import { shared } from "../../styles";
import { EMPTY_VIEW, STATUS, VIEWS, VIEW_LABELS, bookingLink } from "./helpers";
import { bookingStyles as bs } from "./ui";

const ROWS = 30;

/** What the Bookings tab shows; kept by the sheet so it survives opening a booking. */
export type BookingFilters = {
  tab: "bookings" | "pages";
  view: BookingView;
  q: string;
  pageId: string | null;
};

/**
 * The sheet's first page: bookings across your pages (stats, views, search,
 * a page filter and CSV export) and your booking pages.
 */
export function BookingsHome({
  filters,
  onFilters,
  pages,
  onPages,
  onOpenPage,
  onOpenBooking,
}: {
  filters: BookingFilters;
  onFilters: (patch: Partial<BookingFilters>) => void;
  pages: BookingPage[] | null;
  onPages: (pages: BookingPage[]) => void;
  onOpenPage: (page: BookingPage | null) => void;
  onOpenBooking: (booking: Booking) => void;
}) {
  const { busy, error, setError, run } = useRun();
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState<BookingStats | null>(null);
  const [rows, setRows] = useState<Booking[] | null>(null);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState(filters.q.trim());
  const { view, pageId, tab } = filters;
  // Only the newest list request may update the rows.
  const latest = useRef(0);

  // Search once typing pauses.
  useEffect(() => {
    const t = setTimeout(() => setQ(filters.q.trim()), 300);
    return () => clearTimeout(t);
  }, [filters.q]);

  const loadRows = useCallback(
    async (offset: number) => {
      const ticket = ++latest.current;
      const page = await client.bookings({
        view,
        page_id: pageId ?? undefined,
        q: q || undefined,
        limit: ROWS,
        offset,
      });
      if (ticket !== latest.current) return;
      animateLayout();
      setRows((prev) =>
        offset === 0 || !prev ? page.rows : [...prev, ...page.rows],
      );
      setTotal(page.total);
    },
    [view, pageId, q],
  );
  const loadStats = useCallback(
    async () => setStats(await client.bookingStats(pageId ?? undefined)),
    [pageId],
  );
  const loadPages = useCallback(
    async () => onPages(await client.listBookingPages()),
    [onPages],
  );

  useEffect(() => {
    void run(loadPages);
  }, [run, loadPages]);
  useEffect(() => {
    void run(loadStats);
  }, [run, loadStats]);
  useEffect(() => {
    void run(() => loadRows(0));
  }, [run, loadRows]);

  const refresh = async () => {
    setRefreshing(true);
    await run(() => Promise.all([loadPages(), loadStats(), loadRows(0)]));
    setRefreshing(false);
  };

  const exportCsv = () =>
    run(async () => {
      const csv = await client.exportBookingsCsv({
        view,
        page_id: pageId ?? undefined,
        q: q || undefined,
      });
      await Share.share({ message: csv, title: "Bookings" }).catch(() => {});
    });

  const needsApproval = stats?.needs_approval ?? 0;
  const filtered = pages?.find((p) => p.id === pageId);

  return (
    <ScrollView
      contentContainerStyle={sheetStyles.body}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void refresh()}
          tintColor={colors.accent}
          colors={[colors.accent]}
        />
      }
    >
      <View style={sheetStyles.column}>
        <ErrorBanner error={error} onDismiss={() => setError("")} />
        <Segmented
          options={["bookings", "pages"] as const}
          value={tab}
          labels={{ bookings: "Bookings", pages: "Pages" }}
          badges={{ bookings: needsApproval }}
          accessibilityLabel="Show"
          onChange={(t) => {
            animateLayout();
            onFilters({ tab: t });
          }}
        />
        <View style={s.gap} />
        {tab === "pages" ? (
          <PageList pages={pages} busy={busy} onOpen={onOpenPage} />
        ) : (
          <>
            <Stats stats={stats} />
            <View style={s.search}>
              <View style={s.searchIcon} pointerEvents="none">
                <Icon name="search" size={17} color={colors.muted} />
              </View>
              <TextInput
                style={[shared.input, s.searchInput]}
                placeholder="Search by name or email"
                placeholderTextColor={colors.faint}
                value={filters.q}
                onChangeText={(text) => onFilters({ q: text })}
                maxLength={100}
                autoCorrect={false}
                autoCapitalize="none"
                clearButtonMode="while-editing"
                returnKeyType="search"
                accessibilityLabel="Search bookings by name or email"
              />
            </View>
            <Segmented
              wrap
              options={VIEWS}
              value={view}
              labels={VIEW_LABELS}
              badges={{ needs_approval: needsApproval }}
              accessibilityLabel="Which bookings"
              onChange={(v) => onFilters({ view: v })}
            />
            {!!pages && pages.length > 1 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={s.pageScroll}
                contentContainerStyle={s.pageChips}
              >
                <ChipRow label="Booking page" style={s.noWrap}>
                  <Chip
                    label="All pages"
                    selected={!pageId}
                    onPress={() => onFilters({ pageId: null })}
                  />
                  {pages.map((p) => (
                    <Chip
                      key={p.id}
                      label={p.title}
                      color={p.color}
                      selected={pageId === p.id}
                      onPress={() => onFilters({ pageId: p.id })}
                    />
                  ))}
                </ChipRow>
              </ScrollView>
            )}
            <View style={s.gap} />
            {rows === null ? (
              <Text style={shared.small}>{busy ? "Loading…" : ""}</Text>
            ) : rows.length === 0 ? (
              <View style={[shared.card, shared.empty]}>
                <View style={shared.emptyIcon}>
                  <Icon name="calendar" size={24} color={colors.accent} />
                </View>
                <Text style={[shared.sectionTitle, s.center]}>
                  {q ? `No bookings match “${q}”.` : EMPTY_VIEW[view]}
                </Text>
                {!q && view === "upcoming" && (
                  <Text style={[shared.subtitle, s.center]}>
                    Share a booking page and new bookings show up here.
                  </Text>
                )}
              </View>
            ) : (
              <View style={bs.list}>
                {rows.map((b, n) => (
                  <BookingRow
                    key={b.id}
                    booking={b}
                    index={n}
                    showPage={!filtered}
                    onPress={() => onOpenBooking(b)}
                  />
                ))}
              </View>
            )}
            {!!rows && rows.length < total && (
              <Button
                secondary
                title={busy ? "Loading…" : `Load more (${total - rows.length})`}
                disabled={busy}
                onPress={() => void run(() => loadRows(rows.length))}
              />
            )}
            <Button
              secondary
              title="Export as CSV"
              icon="share"
              disabled={busy || !rows?.length}
              onPress={() => void exportCsv()}
            />
            <Text style={[shared.small, s.center]}>
              Exports {VIEW_LABELS[view].toLowerCase()} bookings
              {filtered ? ` on ${filtered.title}` : ""}
              {q ? ` matching “${q}”` : ""}, for spreadsheets.
            </Text>
          </>
        )}
      </View>
    </ScrollView>
  );
}

function Stats({ stats }: { stats: BookingStats | null }) {
  const tiles = [
    { label: "Upcoming", value: stats?.upcoming },
    {
      label: "To approve",
      value: stats?.needs_approval,
      warn: !!stats?.needs_approval,
    },
    { label: "Last 30 days", value: stats?.last_30_days },
    {
      label: "Cancelled",
      value: stats
        ? `${Math.round(stats.cancellation_rate * 100)}%`
        : undefined,
    },
    { label: "No-shows", value: stats?.no_show },
  ];
  return (
    <View style={s.stats}>
      {tiles.map((t) => (
        <View
          key={t.label}
          style={[s.stat, t.warn && s.statWarn]}
          accessible
          accessibilityLabel={`${t.label}: ${t.value ?? "loading"}`}
        >
          <Text style={[s.statValue, t.warn && { color: "#a3742b" }]}>
            {t.value ?? "–"}
          </Text>
          <Text style={shared.small} numberOfLines={1}>
            {t.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

function BookingRow({
  booking: b,
  index,
  showPage,
  onPress,
}: {
  booking: Booking;
  index: number;
  showPage: boolean;
  onPress: () => void;
}) {
  const status = b.no_show
    ? { label: "No-show", tone: "danger" as const }
    : b.status === "confirmed"
      ? null
      : STATUS[b.status];
  return (
    <FadeIn index={index} style={[index > 0 && bs.divider]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${b.name}, ${slotLabel(b.start_at, b.end_at)}${status ? `, ${status.label}` : ""}`}
        accessibilityHint="Opens this booking"
        onPress={onPress}
        style={({ pressed }) => [s.row, pressed && bs.pressed]}
      >
        <View style={{ flex: 1 }}>
          <Text style={bs.rowTitle} numberOfLines={1}>
            {b.name}
          </Text>
          <Text style={shared.small}>{slotLabel(b.start_at, b.end_at)}</Text>
          <Text style={shared.small} numberOfLines={1}>
            {showPage ? `${b.page_title} · ${b.email}` : b.email}
          </Text>
          {status && (
            <View style={[s.pill, bs.top]}>
              <Pill label={status.label} tone={status.tone} />
            </View>
          )}
        </View>
        <Icon name="chevronRight" size={16} color={colors.faint} />
      </Pressable>
    </FadeIn>
  );
}

function PageList({
  pages,
  busy,
  onOpen,
}: {
  pages: BookingPage[] | null;
  busy: boolean;
  onOpen: (page: BookingPage | null) => void;
}) {
  return (
    <>
      <Text style={[shared.subtitle, s.intro]}>
        Share a link and people can pick a time that works for you. Your
        calendar stays private; they only see free times.
      </Text>
      {pages === null ? (
        <Text style={shared.small}>{busy ? "Loading…" : ""}</Text>
      ) : pages.length === 0 ? (
        <View style={[shared.card, shared.empty]}>
          <View style={shared.emptyIcon}>
            <Icon name="link" size={24} color={colors.accent} />
          </View>
          <Text style={shared.sectionTitle}>No booking pages yet.</Text>
          <Text style={[shared.subtitle, s.center]}>
            Make one for office hours, intro calls or anything people book with
            you.
          </Text>
        </View>
      ) : (
        <View style={bs.list}>
          {pages.map((p, n) => (
            <View key={p.id} style={[n > 0 && bs.divider]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${p.title}${p.active ? "" : ", turned off"}, ${p.counts.upcoming} upcoming${p.counts.needs_approval ? `, ${p.counts.needs_approval} to approve` : ""}`}
                accessibilityHint="Edit this page"
                onPress={() => onOpen(p)}
                style={({ pressed }) => [s.pageRow, pressed && bs.pressed]}
              >
                <View style={[s.dot, { backgroundColor: p.color }]} />
                <View style={{ flex: 1 }}>
                  <Text style={bs.rowTitle}>{p.title}</Text>
                  <Text style={shared.small} numberOfLines={1}>
                    /book/{p.slug} ·{" "}
                    {p.durations.map((d) => minutesLabel(d)).join(", ")}
                  </Text>
                  <Text style={shared.small}>{p.counts.upcoming} upcoming</Text>
                </View>
                {p.counts.needs_approval > 0 && (
                  <Pill
                    label={`${p.counts.needs_approval} to approve`}
                    tone="warning"
                  />
                )}
                {!p.active && <Pill label="Off" />}
                <Icon name="chevronRight" size={16} color={colors.faint} />
              </Pressable>
              <View style={s.rowActions}>
                <SmallAction
                  label="Share link"
                  disabled={!p.active}
                  onPress={() => void shareText(bookingLink(p.slug))}
                />
              </View>
            </View>
          ))}
        </View>
      )}
      <Button
        title="New booking page"
        icon="plus"
        onPress={() => onOpen(null)}
      />
    </>
  );
}

const s = StyleSheet.create({
  gap: { height: 14 },
  intro: { marginTop: 0, marginBottom: 18 },
  center: { textAlign: "center" },
  stats: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
  stat: {
    flexGrow: 1,
    flexBasis: "30%",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.input,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  statWarn: { backgroundColor: "#fbf3e2", borderColor: "#f1e2bf" },
  statValue: {
    fontFamily: fonts.display,
    fontSize: 20,
    letterSpacing: -0.4,
    color: colors.text,
  },
  search: { marginBottom: 12, justifyContent: "center" },
  searchIcon: { position: "absolute", left: 15, zIndex: 1 },
  searchInput: { paddingLeft: 42 },
  pageScroll: { marginHorizontal: -20, marginTop: 12 },
  pageChips: { paddingHorizontal: 20 },
  noWrap: { flexWrap: "nowrap" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  pill: { flexDirection: "row" },
  pageRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingTop: 14,
    paddingBottom: 6,
    paddingHorizontal: 16,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  rowActions: {
    flexDirection: "row",
    paddingLeft: 36,
    paddingRight: 16,
    paddingBottom: 12,
  },
});
