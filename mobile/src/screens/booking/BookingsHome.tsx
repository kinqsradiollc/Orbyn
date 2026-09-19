import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  dateLabel,
  type Booking,
  type BookingPage,
  type BookingStats,
  type BookingView,
  type User,
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
import { minutesLabel, rangeLabel, shareText } from "../../lib/planning";
import { useRun } from "../../hooks/useRun";
import { FadeIn, animateLayout } from "../../motion";
import { colors, fonts, radii, spacing, themed } from "../../theme";
import { shared } from "../../styles";
import {
  EMPTY_VIEW,
  STATUS,
  VIEWS,
  VIEW_LABELS,
  bookingLink,
  canEditPage,
  dayHeading,
  dayKeyOf,
  lengthOf,
} from "./helpers";
import { InviteList } from "./Invites";
import { ProfileCard } from "./ProfileCard";
import { bookingStyles as bs } from "./ui";

const ROWS = 30;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** What the Bookings tab shows; kept by the sheet so it survives opening a booking. */
export type BookingFilters = {
  tab: "bookings" | "pages" | "invites";
  view: BookingView;
  q: string;
  pageId: string | null;
};

/**
 * The sheet's first page: bookings across your pages (stats, views, search,
 * a page filter and CSV export) and your booking pages.
 */
export function BookingsHome({
  user,
  filters,
  onFilters,
  pages,
  onPages,
  onOpenPage,
  onOpenBooking,
  onNewInvite,
}: {
  user: User | null;
  filters: BookingFilters;
  onFilters: (patch: Partial<BookingFilters>) => void;
  pages: BookingPage[] | null;
  onPages: (pages: BookingPage[]) => void;
  onOpenPage: (page: BookingPage | null) => void;
  onOpenBooking: (booking: Booking) => void;
  /** Opens the Offer times form. */
  onNewInvite: () => void;
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

  /** Guards Load more against a second tap while a page is still loading. */
  const loadingMore = useRef(false);
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

  // Sharing a file needs expo-file-system and expo-sharing; until then the
  // CSV goes out as text under the file's name.
  const exportCsv = () =>
    run(async () => {
      const csv = await client.exportBookingsCsv({
        view,
        page_id: pageId ?? undefined,
        q: q || undefined,
      });
      await Share.share({ message: csv, title: "bookings.csv" }).catch(
        () => {},
      );
    });

  /** The bookings list, filtered to one page and view. */
  const showBookings = (page: BookingPage, next: BookingView) => {
    animateLayout();
    onFilters({ tab: "bookings", pageId: page.id, view: next, q: "" });
  };

  const needsApproval = stats?.needs_approval ?? 0;
  const filtered = pages?.find((p) => p.id === pageId);
  const pageColor = new Map((pages ?? []).map((p) => [p.id, p.color]));
  // Consecutive rows on the same local day share a heading; the server's
  // order (soonest first, or latest first for past bookings) is kept.
  const groups: [string, Booking[]][] = [];
  for (const b of rows ?? []) {
    const key = dayKeyOf(new Date(b.start_at));
    const last = groups[groups.length - 1];
    if (last?.[0] === key) last[1].push(b);
    else groups.push([key, [b]]);
  }

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
          options={["bookings", "pages", "invites"] as const}
          value={tab}
          labels={{ bookings: "Bookings", pages: "Pages", invites: "Invites" }}
          badges={{ bookings: needsApproval }}
          accessibilityLabel="Show"
          onChange={(t) => {
            animateLayout();
            onFilters({ tab: t });
          }}
        />
        <View style={s.gap} />
        {tab === "invites" ? (
          <InviteList onNew={onNewInvite} />
        ) : tab === "pages" ? (
          <>
            <ProfileCard />
            <PageList
              pages={pages}
              busy={busy}
              userId={user?.id}
              onOpen={onOpenPage}
              onShowBookings={showBookings}
            />
          </>
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
            {!!pages && (pages.length > 1 || !!pageId) && (
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
              pages?.length === 0 && !q ? (
                <View style={[shared.card, shared.empty]}>
                  <View style={shared.emptyIcon}>
                    <Icon name="link" size={24} color={colors.accent} />
                  </View>
                  <Text style={[shared.sectionTitle, s.center]}>
                    No booking pages yet.
                  </Text>
                  <Text style={[shared.subtitle, s.center, s.emptyBody]}>
                    Make a booking page and share its link. Bookings show up
                    here.
                  </Text>
                  <Button
                    title="New booking page"
                    icon="plus"
                    style={bs.last}
                    onPress={() => onOpenPage(null)}
                  />
                </View>
              ) : (
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
              )
            ) : (
              groups.map(([key, list], g) => (
                <View key={`${key}-${g}`}>
                  <Text
                    style={[shared.eyebrow, s.dayHeading]}
                    accessibilityRole="header"
                  >
                    {dayHeading(key).toUpperCase()}
                  </Text>
                  <View style={bs.list}>
                    {list.map((b, n) => (
                      <BookingRow
                        key={b.id}
                        booking={b}
                        index={n}
                        showPage={!filtered}
                        color={b.page_id ? pageColor.get(b.page_id) : undefined}
                        onPress={() => onOpenBooking(b)}
                      />
                    ))}
                  </View>
                </View>
              ))
            )}
            {!!rows && rows.length < total && (
              <Button
                secondary
                title={busy ? "Loading…" : `Load more (${total - rows.length})`}
                disabled={busy}
                onPress={() => {
                  if (loadingMore.current) return;
                  loadingMore.current = true;
                  void run(() => loadRows(rows.length)).finally(() => {
                    loadingMore.current = false;
                  });
                }}
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
    {
      label: "Upcoming",
      value: stats?.upcoming,
      sub: stats
        ? stats.next
          ? `Next ${dateLabel(stats.next.start_at)}`
          : "Nothing booked"
        : "",
    },
    {
      label: "To approve",
      value: stats?.needs_approval,
      warn: !!stats?.needs_approval,
      sub: stats?.awaiting_email
        ? `${stats.awaiting_email} awaiting email`
        : "",
    },
    { label: "Last 30 days", value: stats?.last_30_days, sub: "" },
    {
      label: "Cancelled",
      value: stats
        ? `${Math.round(stats.cancellation_rate * 100)}%`
        : undefined,
      sub: stats ? plural(stats.cancelled, "cancellation") : "",
    },
    { label: "No-shows", value: stats?.no_show, sub: "" },
  ];
  return (
    <View style={s.stats}>
      {tiles.map((t) => (
        <View
          key={t.label}
          style={[s.stat, t.warn && s.statWarn]}
          accessible
          accessibilityLabel={`${t.label}: ${t.value ?? "loading"}${t.sub ? `, ${t.sub}` : ""}`}
        >
          <Text style={[s.statValue, t.warn && { color: colors.warning }]}>
            {t.value ?? "–"}
          </Text>
          <Text style={shared.small}>{t.label}</Text>
          {!!t.sub && (
            <Text style={[shared.small, s.statSub]} numberOfLines={2}>
              {t.sub}
            </Text>
          )}
        </View>
      ))}
    </View>
  );
}

function BookingRow({
  booking: b,
  index,
  showPage,
  color,
  onPress,
}: {
  booking: Booking;
  index: number;
  showPage: boolean;
  /** The booking page's colour. */
  color: string | undefined;
  onPress: () => void;
}) {
  const status = b.status === "confirmed" ? null : STATUS[b.status];
  const length = minutesLabel(lengthOf(b));
  const moved = b.reschedule_count > 0;
  const when = `${rangeLabel(b.start_at, b.end_at)} · ${length}`;
  return (
    <FadeIn index={index} style={[index > 0 && bs.divider]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={[
          b.name,
          when,
          showPage && (b.page_title ?? "Open invite"),
          status?.label,
          b.no_show && "No-show",
          moved && "Moved",
        ]
          .filter(Boolean)
          .join(", ")}
        accessibilityHint="Opens this booking"
        onPress={onPress}
        style={({ pressed }) => [s.row, pressed && bs.pressed]}
      >
        <View style={{ flex: 1 }}>
          <Text style={bs.rowTitle} numberOfLines={1}>
            {b.name}
          </Text>
          <Text style={shared.small}>{when}</Text>
          <View style={s.pageLine}>
            {showPage && (
              <View
                style={[
                  s.smallDot,
                  { backgroundColor: color ?? colors.accent },
                ]}
              />
            )}
            <Text style={[shared.small, { flex: 1 }]} numberOfLines={1}>
              {showPage
                ? `${b.page_title ?? "Open invite"} · ${b.email}`
                : b.email}
            </Text>
          </View>
          {(status || b.no_show || moved) && (
            <View style={[s.pills, bs.top]}>
              {status && <Pill label={status.label} tone={status.tone} />}
              {b.no_show && <Pill label="No-show" tone="danger" />}
              {moved && <Pill label="Moved" />}
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
  userId,
  onOpen,
  onShowBookings,
}: {
  pages: BookingPage[] | null;
  busy: boolean;
  userId: string | undefined;
  onOpen: (page: BookingPage | null) => void;
  onShowBookings: (page: BookingPage, view: BookingView) => void;
}) {
  // Pages you co-host but can't change open a read-only summary instead.
  const [expanded, setExpanded] = useState<string | null>(null);
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
          {pages.map((p, n) => {
            const editable = canEditPage(p, userId);
            const open = !editable && expanded === p.id;
            const others = p.hosts
              .filter((h) => h.user_id !== userId)
              .map((h) => h.name);
            const owner = p.hosts.find((h) => h.user_id === p.owner_id)?.name;
            const summary = [
              !!p.team_id && `${p.team_name ?? "Team"} page`,
              `${p.counts.upcoming} upcoming`,
              `up to ${plural(p.window_days, "day")} ahead`,
              p.requires_approval && "approval on",
              others.length > 0 && `with ${others.join(", ")}`,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <View key={p.id} style={[n > 0 && bs.divider]}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${p.title}${p.active ? "" : ", turned off"}, ${summary}`}
                  accessibilityHint={
                    editable ? "Edit this page" : "Shows this page’s details"
                  }
                  accessibilityState={editable ? undefined : { expanded: open }}
                  onPress={() => {
                    if (editable) return onOpen(p);
                    animateLayout();
                    setExpanded(open ? null : p.id);
                  }}
                  style={({ pressed }) => [s.pageRow, pressed && bs.pressed]}
                >
                  <View style={[s.dot, { backgroundColor: p.color }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={bs.rowTitle}>{p.title}</Text>
                    <Text style={shared.small} numberOfLines={1}>
                      /book/{p.slug} ·{" "}
                      {p.durations.map((d) => minutesLabel(d)).join(", ")}
                    </Text>
                    <Text style={shared.small} numberOfLines={2}>
                      {summary}
                    </Text>
                  </View>
                  {!p.active && <Pill label="Off" />}
                  <View style={open && s.turned}>
                    <Icon name="chevronRight" size={16} color={colors.faint} />
                  </View>
                </Pressable>
                {open && (
                  <View style={s.readOnly}>
                    {!!p.description && (
                      <Text style={[shared.body, s.readLine]}>
                        {p.description}
                      </Text>
                    )}
                    {!!p.location && (
                      <Text style={[shared.small, s.readLine]}>
                        Where: {p.location}
                      </Text>
                    )}
                    <Text style={shared.small}>
                      {p.team_id
                        ? `This is ${p.team_name ?? "your team"}’s page: you can share it and see its bookings. Its owners and admins can change it.`
                        : `You’re a co-host here, so you can share it and see its bookings. ${
                            owner
                              ? `Only ${owner} can change it.`
                              : "Only its owner can change it."
                          }`}
                    </Text>
                  </View>
                )}
                <View style={s.rowActions}>
                  {p.counts.needs_approval > 0 && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${p.counts.needs_approval} to approve`}
                      accessibilityHint="Shows the requests waiting on this page"
                      hitSlop={6}
                      onPress={() => onShowBookings(p, "needs_approval")}
                      style={({ pressed }) => [
                        s.approvePill,
                        pressed && { opacity: 0.7 },
                      ]}
                    >
                      <Pill
                        label={`${p.counts.needs_approval} to approve`}
                        tone="warning"
                      />
                    </Pressable>
                  )}
                  <SmallAction
                    label="Bookings"
                    disabled={false}
                    onPress={() => onShowBookings(p, "upcoming")}
                  />
                  <SmallAction
                    label="Share link"
                    disabled={!p.active}
                    onPress={() => void shareText(bookingLink(p.slug))}
                  />
                  <SmallAction
                    label="Preview"
                    disabled={false}
                    onPress={() =>
                      void Linking.openURL(bookingLink(p.slug)).catch(() => {})
                    }
                  />
                </View>
              </View>
            );
          })}
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

const s = themed(() =>
  StyleSheet.create({
    gap: { height: 14 },
    intro: { marginTop: 0, marginBottom: 18 },
    center: { textAlign: "center" },
    emptyBody: { marginBottom: 14 },
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
    statWarn: {
      backgroundColor: colors.warningSoft,
      borderColor: colors.warningLine,
    },
    statValue: {
      fontFamily: fonts.display,
      fontSize: 20,
      letterSpacing: -0.4,
      color: colors.text,
    },
    statSub: { marginTop: 2, fontSize: 11 },
    search: { marginBottom: 12, justifyContent: "center" },
    searchIcon: { position: "absolute", left: 15, zIndex: 1 },
    searchInput: { paddingLeft: 42 },
    pageScroll: { marginHorizontal: -spacing.page, marginTop: 12 },
    pageChips: { paddingHorizontal: spacing.page },
    noWrap: { flexWrap: "nowrap" },
    dayHeading: { marginTop: 4 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 12,
      paddingHorizontal: 16,
    },
    pageLine: { flexDirection: "row", alignItems: "center", gap: 6 },
    smallDot: { width: 8, height: 8, borderRadius: 4 },
    pills: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    pageRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingTop: 14,
      paddingBottom: 6,
      paddingHorizontal: 16,
    },
    dot: { width: 10, height: 10, borderRadius: 5 },
    turned: { transform: [{ rotate: "90deg" }] },
    readOnly: { paddingLeft: 36, paddingRight: 16, paddingBottom: 6 },
    readLine: { marginBottom: 4 },
    rowActions: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 6,
      paddingLeft: 36,
      paddingRight: 16,
      paddingTop: 4,
      paddingBottom: 12,
    },
    approvePill: { justifyContent: "center" },
  }),
);
