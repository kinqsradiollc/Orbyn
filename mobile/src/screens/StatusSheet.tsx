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
  serviceStateLabels,
  statusHeadlines,
  type Maintenance,
  type ServiceState,
  type StatusComponent,
  type StatusIncident,
  type StatusReport,
} from "@orbyn/core";
import { ErrorBanner } from "../components/ErrorBanner";
import { Icon } from "../components/Icon";
import { formatUntil, maintenanceTone } from "../components/MaintenanceBanner";
import { Pill } from "../components/Pill";
import { Sheet, sheetStyles } from "../components/Sheet";
import { client } from "../lib/api";
import { FadeIn } from "../motion";
import { colors, fonts, radii, themed } from "../theme";
import { shared } from "../styles";
import { errorText } from "../lib/errors";

const REFRESH_MS = 30_000;
const HISTORY_DAYS = 30;

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

/**
 * Public service status: overall headline, one card per component with
 * uptime and a 30-day history strip, and recent incidents. Refreshes every
 * 30 seconds while open, and on pull.
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
              <Text style={[shared.eyebrow, s.section]}>COMPONENTS</Text>
              {report.components.map((c, n) => (
                <FadeIn key={c.id} index={n + 1}>
                  <ComponentCard component={c} />
                </FadeIn>
              ))}
              <Text style={[shared.eyebrow, s.section]}>RECENT INCIDENTS</Text>
              <Incidents
                incidents={report.incidents}
                components={report.components}
                offset={report.components.length + 1}
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
        <Text style={shared.small}>{updatedAgo(report.updated_at, now)}</Text>
      </View>
    </FadeIn>
  );
}

function ComponentCard({ component: c }: { component: StatusComponent }) {
  const days = c.history.slice(-HISTORY_DAYS);
  const tracked = days.filter((d) => d.uptime !== null).length;
  const uptime = [
    { label: "24 hours", value: c.uptime.day },
    { label: "7 days", value: c.uptime.week },
    { label: "90 days", value: c.uptime.quarter },
  ];
  return (
    <View style={shared.card}>
      <View style={s.cardTop}>
        <View style={{ flex: 1 }}>
          <Text style={s.name}>{c.name}</Text>
          {!!c.description && <Text style={shared.small}>{c.description}</Text>}
        </View>
        <View style={s.stateCol}>
          <Pill
            label={serviceStateLabels[c.state]}
            tone={STATE_TONE[c.state].pill}
          />
          <Text style={[shared.small, s.latency]}>
            {c.latency_ms === null ? "—" : `${Math.round(c.latency_ms)} ms`}
          </Text>
        </View>
      </View>
      <View style={s.uptimeRow}>
        {uptime.map((u) => (
          <View key={u.label} style={s.uptimeCell}>
            <Text style={s.uptimeValue}>{formatUptime(u.value)}</Text>
            <Text style={shared.small}>{u.label}</Text>
          </View>
        ))}
      </View>
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

function Incidents({
  incidents,
  components,
  offset,
}: {
  incidents: StatusIncident[];
  components: StatusComponent[];
  offset: number;
}) {
  if (!incidents.length)
    return (
      <FadeIn index={offset} style={shared.card}>
        <Text style={shared.body}>No recent incidents.</Text>
      </FadeIn>
    );
  const componentName = (id: string, fallback: string) =>
    components.find((c) => c.id === id)?.name ?? fallback ?? id;
  return (
    <View style={s.list}>
      {incidents.map((incident, n) => {
        const ongoing = incident.resolved_at === null;
        return (
          <FadeIn
            key={`${incident.component}-${incident.started_at}`}
            index={offset + n}
            style={[s.incident, n > 0 && s.divider]}
          >
            <View style={s.incidentTop}>
              <Text style={[s.name, { flex: 1 }]} numberOfLines={1}>
                {componentName(incident.component, incident.name)}
              </Text>
              <Pill
                label={ongoing ? "Ongoing" : "Resolved"}
                tone={ongoing ? "danger" : "accent"}
              />
            </View>
            <Text style={shared.small}>
              Started {formatTime(incident.started_at)} ·{" "}
              {ongoing ? "for " : "lasted "}
              {formatDuration(incident.duration_s)}
            </Text>
          </FadeIn>
        );
      })}
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
    cardTop: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
    name: {
      fontFamily: fonts.semibold,
      fontSize: 15,
      color: colors.text,
      marginBottom: 2,
    },
    stateCol: { alignItems: "flex-end", gap: 4 },
    latency: { textAlign: "right" },
    uptimeRow: {
      flexDirection: "row",
      marginTop: 14,
      paddingTop: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    uptimeCell: { flex: 1 },
    uptimeValue: {
      fontFamily: fonts.semibold,
      fontSize: 15,
      color: colors.text,
      fontVariant: ["tabular-nums"],
    },
    strip: { flexDirection: "row", gap: 2, height: 26, marginTop: 14 },
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
    incident: { paddingVertical: 13, paddingHorizontal: 16, gap: 4 },
    incidentTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  }),
);
