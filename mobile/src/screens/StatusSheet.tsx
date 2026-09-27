import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  formatUptime,
  groupStatusComponents,
  groupSummary,
  incidentSeverity,
  incidentSeverityLabels,
  incidentUpdates,
  isProblemState,
  serviceStateLabels,
  splitIncidents,
  statusHeadlines,
  statusSummary,
  type IncidentSeverity,
  type Maintenance,
  type ServiceState,
  type StatusComponent,
  type StatusGroup,
  type StatusIncident,
  type StatusReport,
} from "@orbyn/core";
import { ErrorBanner } from "../components/ErrorBanner";
import { Icon } from "../components/Icon";
import { formatUntil, maintenanceTone } from "../components/MaintenanceBanner";
import { Pill } from "../components/Pill";
import { Sheet, sheetStyles } from "../components/Sheet";
import { client } from "../lib/api";
import { FadeIn, Pressable } from "../motion";
import { colors, controls, fonts, radii, themed } from "../theme";
import { shared } from "../styles";
import { errorText } from "../lib/errors";

const REFRESH_MS = 30_000;
const HISTORY_DAYS = 30;
/** Past incidents shown at first, and added by each "Show more". */
const INCIDENT_PAGE = 5;

const SEVERITY_PILL: Record<IncidentSeverity, "danger" | "warning" | "muted"> =
  { major: "danger", minor: "warning", brief: "muted" };

const STATE_TONE = themed<
  Record<
    ServiceState,
    { bg: string; fg: string; pill: "accent" | "warning" | "danger" | "muted" }
  >
>(() => ({
  operational: { bg: colors.accentSoft, fg: colors.accent, pill: "accent" },
  degraded: { bg: colors.warningSoft, fg: colors.warning, pill: "warning" },
  outage: { bg: colors.dangerSoft, fg: colors.danger, pill: "danger" },
  unknown: { bg: colors.surfaceMuted, fg: colors.textSoft, pill: "muted" },
}));

/** Bar colour for one day of the history strip. */
const dayColor = (uptime: number | null) =>
  uptime === null
    ? colors.border
    : uptime >= 0.999
      ? colors.accent
      : uptime >= 0.99
        ? colors.dot
        : uptime >= 0.95
          ? colors.amber
          : colors.danger;

const updatedAgo = (iso: string, now: number) => {
  const minutes = Math.floor((now - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 1) return "Updated just now";
  if (minutes < 60) return `Updated ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24
    ? `Updated ${hours} h ago`
    : `Updated ${Math.floor(hours / 24)} d ago`;
};

/** "45 s", "12 min", "2 h 5 min", "1 d 3 h". */
const formatDuration = (seconds: number) => {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const restMin = minutes % 60;
  if (hours < 24) return restMin ? `${hours} h ${restMin} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  const restH = hours % 24;
  return restH ? `${days} d ${restH} h` : `${days} d`;
};

const formatTime = (iso: string) =>
  new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

const formatClock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** "Sep 24, 10:02 – 10:40", or both dates when it ran past midnight. */
const incidentSpan = (i: StatusIncident) => {
  if (!i.resolved_at) return `Since ${formatTime(i.started_at)}`;
  const sameDay =
    new Date(i.started_at).toDateString() ===
    new Date(i.resolved_at).toDateString();
  return `${formatTime(i.started_at)} – ${
    sameDay ? formatClock(i.resolved_at) : formatTime(i.resolved_at)
  }`;
};

/**
 * Public service status, compact: the overall headline and a one-line
 * summary, incidents still going, components in groups (a healthy group is
 * one row, a troubled one opens), and past incidents a few at a time, each
 * opening to its updates. Refreshes every 30 seconds while open, and on pull.
 */
export function StatusSheet({
  visible,
  onClose,
  onDismiss,
}: {
  visible: boolean;
  onClose: () => void;
  onDismiss?: () => void;
}) {
  const [report, setReport] = useState<StatusReport | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const next = await client.getStatus();
      if (mine !== seq.current) return;
      setReport(next);
      setError("");
    } catch (e) {
      if (mine === seq.current) setError(errorText(e));
    } finally {
      if (mine === seq.current) setNow(Date.now());
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => {
      clearInterval(timer);
      seq.current++; // ignore responses that land after closing
    };
  }, [visible, load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <Sheet
      visible={visible}
      title="Service status"
      onClose={onClose}
      onDismiss={onDismiss}
    >
      <ScrollView
        contentContainerStyle={sheetStyles.body}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
      >
        <View style={sheetStyles.column}>
          <ErrorBanner error={error} onDismiss={() => setError("")} />
          {!report ? (
            <Text style={shared.small}>
              {error
                ? "Couldn't load the status report. Pull down to try again."
                : "Checking our systems…"}
            </Text>
          ) : (
            <>
              {report.maintenance?.enabled && (
                <MaintenanceNotice maintenance={report.maintenance} />
              )}
              <Headline report={report} now={now} />
              <ActiveIncidents
                incidents={splitIncidents(report.incidents).active}
              />
              <Text style={[shared.eyebrow, s.section]}>COMPONENTS</Text>
              {groupStatusComponents(report.components).map((g, n) => (
                <FadeIn key={g.id} index={n + 1}>
                  <GroupCard group={g} />
                </FadeIn>
              ))}
              <Text style={[shared.eyebrow, s.section]}>PAST INCIDENTS</Text>
              <PastIncidents
                incidents={splitIncidents(report.incidents).past}
              />
            </>
          )}
        </View>
      </ScrollView>
    </Sheet>
  );
}

/** Shown above the headline while an admin has maintenance mode on. */
function MaintenanceNotice({ maintenance }: { maintenance: Maintenance }) {
  return (
    <FadeIn style={s.maintenance}>
      <View style={[s.bannerIcon, { backgroundColor: maintenanceTone.fg }]}>
        <Icon name="clock" size={18} color={colors.white} strokeWidth={2.2} />
      </View>
      <View style={{ flex: 1 }} accessible accessibilityRole="alert">
        <Text style={[s.bannerTitle, { color: maintenanceTone.fg }]}>
          Maintenance in progress
        </Text>
        <Text style={shared.body}>
          {maintenance.message.trim() ||
            "You can view everything, but changes are paused."}
        </Text>
        {maintenance.until && (
          <Text style={[shared.small, s.until]}>
            Expected back {formatUntil(maintenance.until)}
          </Text>
        )}
      </View>
    </FadeIn>
  );
}

function Headline({ report, now }: { report: StatusReport; now: number }) {
  const tone = STATE_TONE[report.state];
  return (
    <FadeIn style={[s.banner, { backgroundColor: tone.bg }]}>
      <View style={[s.bannerIcon, { backgroundColor: tone.fg }]}>
        <Icon
          name={report.state === "operational" ? "check" : "activity"}
          size={18}
          color={colors.white}
          strokeWidth={2.2}
        />
      </View>
      <View style={{ flex: 1 }}>
        <Text
          accessibilityRole="header"
          style={[s.bannerTitle, { color: tone.fg }]}
        >
          {statusHeadlines[report.state]}
        </Text>
        <Text style={[shared.small, s.summary]}>
          {statusSummary(report.components, report.incidents)}
        </Text>
        <Text style={shared.small}>{updatedAgo(report.updated_at, now)}</Text>
      </View>
    </FadeIn>
  );
}

/** A group of components: one row when all is well, open when not. */
function GroupCard({ group: g }: { group: StatusGroup }) {
  const problem = isProblemState(g.state);
  const [open, setOpen] = useState(problem);
  useEffect(() => {
    if (problem) setOpen(true);
  }, [problem]);
  return (
    <View style={[shared.card, s.group]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        style={({ pressed }) => [s.groupHead, pressed && { opacity: 0.65 }]}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.name}>{g.name}</Text>
          <Text style={shared.small}>
            {groupSummary(g.components)}
            {g.uptime !== null && ` · ${formatUptime(g.uptime)} over 90 days`}
          </Text>
        </View>
        <Pill
          label={serviceStateLabels[g.state]}
          tone={STATE_TONE[g.state].pill}
        />
        <Icon
          name={open ? "chevronUp" : "chevronDown"}
          size={18}
          color={colors.muted}
        />
      </Pressable>
      {open &&
        g.components.map((c) => <ComponentRow key={c.id} component={c} />)}
    </View>
  );
}

function ComponentRow({ component: c }: { component: StatusComponent }) {
  const days = c.history.slice(-HISTORY_DAYS);
  const tracked = days.filter((d) => d.uptime !== null).length;
  const figures = [
    `24 h ${formatUptime(c.uptime.day)}`,
    `7 d ${formatUptime(c.uptime.week)}`,
    `90 d ${formatUptime(c.uptime.quarter)}`,
    ...(c.latency_ms === null ? [] : [`${Math.round(c.latency_ms)} ms`]),
  ];
  return (
    <View style={[s.component, s.divider]}>
      <View style={s.cardTop}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.componentName}>{c.name}</Text>
          {!!c.description && <Text style={shared.small}>{c.description}</Text>}
        </View>
        <Pill
          label={serviceStateLabels[c.state]}
          tone={STATE_TONE[c.state].pill}
        />
      </View>
      <Text style={[shared.small, s.figures]}>{figures.join(" · ")}</Text>
      <View
        style={s.strip}
        accessible
        accessibilityLabel={`Last ${HISTORY_DAYS} days, ${tracked} with data. 90-day uptime ${formatUptime(c.uptime.quarter)}.`}
      >
        {days.map((d) => (
          <View
            key={d.date}
            style={[s.bar, { backgroundColor: dayColor(d.uptime) }]}
          />
        ))}
      </View>
      <View style={s.stripLegend}>
        <Text style={shared.small}>{HISTORY_DAYS} days ago</Text>
        <Text style={shared.small}>Today</Text>
      </View>
    </View>
  );
}

/** Incidents still going, open, just under the headline. */
function ActiveIncidents({ incidents }: { incidents: StatusIncident[] }) {
  if (!incidents.length) return null;
  return (
    <View style={[s.list, s.activeList]}>
      {incidents.map((incident, n) => (
        <IncidentRow
          key={`${incident.component}-${incident.started_at}`}
          incident={incident}
          first={n === 0}
          startOpen
        />
      ))}
    </View>
  );
}

/** Past incidents, a few at a time, each opening to its updates. */
function PastIncidents({ incidents }: { incidents: StatusIncident[] }) {
  const [shown, setShown] = useState(INCIDENT_PAGE);
  if (!incidents.length)
    return (
      <View style={shared.card}>
        <Text style={shared.body}>No incidents in the last 30 days.</Text>
      </View>
    );
  const rest = incidents.length - shown;
  return (
    <View style={s.list}>
      {incidents.slice(0, shown).map((incident, n) => (
        <IncidentRow
          key={`${incident.component}-${incident.started_at}`}
          incident={incident}
          first={n === 0}
        />
      ))}
      {incidents.length > INCIDENT_PAGE && (
        <View style={[s.more, s.divider]}>
          <Text style={shared.small}>
            Showing {Math.min(shown, incidents.length)} of {incidents.length}
          </Text>
          {rest > 0 && (
            <Pressable
              accessibilityRole="button"
              onPress={() => setShown((v) => v + INCIDENT_PAGE)}
              style={({ pressed }) => [
                s.moreButton,
                pressed && { opacity: 0.65 },
              ]}
            >
              <Text style={s.moreText}>
                Show {Math.min(rest, INCIDENT_PAGE)} more
              </Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

function IncidentRow({
  incident,
  first,
  startOpen = false,
}: {
  incident: StatusIncident;
  first: boolean;
  startOpen?: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  const ongoing = incident.resolved_at === null;
  const severity = incidentSeverity(incident);
  return (
    <View style={[s.incident, !first && s.divider]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        style={({ pressed }) => [s.incidentTop, pressed && { opacity: 0.65 }]}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.componentName} numberOfLines={1}>
            {incident.name}
          </Text>
          <Text style={shared.small}>
            {incidentSpan(incident)} · {ongoing ? "for " : ""}
            {formatDuration(incident.duration_s)}
          </Text>
        </View>
        <Pill
          label={ongoing ? "Ongoing" : incidentSeverityLabels[severity]}
          tone={ongoing ? "danger" : SEVERITY_PILL[severity]}
        />
        <Icon
          name={open ? "chevronUp" : "chevronDown"}
          size={18}
          color={colors.muted}
        />
      </Pressable>
      {open && (
        <View style={s.updates}>
          {incidentUpdates(incident).map((u) => (
            <View key={u.kind} style={s.update}>
              <Text style={shared.small}>
                {u.at ? formatTime(u.at) : "Now"}
              </Text>
              <Text
                style={[
                  shared.body,
                  u.kind === "ongoing" && { color: colors.danger },
                ]}
              >
                {u.text}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    section: { marginTop: 8 },
    maintenance: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 14,
      borderRadius: radii.card,
      borderWidth: 1,
      borderColor: maintenanceTone.border,
      backgroundColor: maintenanceTone.bg,
      padding: 18,
      marginBottom: 12,
    },
    until: { marginTop: 4 },
    banner: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      borderRadius: radii.card,
      padding: 18,
      marginBottom: 16,
    },
    bannerIcon: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
    },
    bannerTitle: {
      fontFamily: fonts.display,
      fontSize: 18,
      letterSpacing: -0.3,
      marginBottom: 2,
    },
    summary: { fontFamily: fonts.semibold, color: colors.text },
    group: { padding: 0, overflow: "hidden" },
    groupHead: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      minHeight: controls.tap,
      padding: 16,
    },
    component: { paddingHorizontal: 16, paddingVertical: 12 },
    componentName: {
      fontFamily: fonts.semibold,
      fontSize: 13,
      color: colors.text,
    },
    figures: { marginTop: 6, fontSize: 11, fontVariant: ["tabular-nums"] },
    activeList: { borderColor: colors.danger },
    updates: {
      marginTop: 4,
      marginLeft: 4,
      paddingLeft: 12,
      borderLeftWidth: 2,
      borderLeftColor: colors.border,
      gap: 8,
      paddingBottom: 4,
    },
    update: { gap: 2 },
    more: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      paddingLeft: 16,
      paddingRight: 8,
    },
    moreButton: {
      minHeight: controls.tap,
      paddingHorizontal: 8,
      justifyContent: "center",
    },
    moreText: {
      fontFamily: fonts.semibold,
      fontSize: 13,
      color: colors.accent,
    },
    cardTop: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
    name: {
      fontFamily: fonts.semibold,
      fontSize: 15,
      color: colors.text,
      marginBottom: 2,
    },
    strip: { flexDirection: "row", gap: 2, height: 18, marginTop: 8 },
    bar: { flex: 1, borderRadius: 2 },
    stripLegend: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginTop: 6,
    },
    list: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      overflow: "hidden",
      marginBottom: 16,
    },
    divider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    incident: { paddingVertical: 6, paddingHorizontal: 16, gap: 4 },
    incidentTop: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      minHeight: controls.tap,
    },
  }),
);
