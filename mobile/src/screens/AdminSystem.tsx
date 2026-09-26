import React, { useEffect, useState } from "react";
import {
  Alert,
  Linking,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Switch } from "../components/Switch";
import type {
  Maintenance,
  SystemSettingKey,
  SystemSettingsUpdate,
  SystemSettingsView,
  UpdateInfo,
  VersionInfo,
} from "@orbyn/core";
import { Button } from "../components/Button";
import { formatUntil } from "../components/MaintenanceBanner";
import { Pill } from "../components/Pill";
import { SmallAction } from "../components/SmallAction";
import { client } from "../lib/api";
import { FadeIn, Pressable } from "../motion";
import { colors, fonts, radii, themed } from "../theme";
import { shared } from "../styles";
import { errorText } from "../lib/errors";

type Act = (fn: () => Promise<void>) => Promise<void>;

const SOURCE = {
  database: { label: "Saved here", tone: "accent" },
  environment: { label: "From .env", tone: "muted" },
} as const;

/** Quick choices for when maintenance is expected to end. */
const UNTIL_CHOICES = [
  { label: "No end time", minutes: 0 },
  { label: "30 min", minutes: 30 },
  { label: "1 hour", minutes: 60 },
  { label: "2 hours", minutes: 120 },
  { label: "4 hours", minutes: 240 },
] as const;

/** "45 s", "12 min", "5 h", "3 d". */
const shortDuration = (seconds: number) =>
  seconds < 60
    ? `${Math.max(0, Math.round(seconds))} s`
    : seconds < 3600
      ? `${Math.round(seconds / 60)} min`
      : seconds < 86400
        ? `${Math.round(seconds / 3600)} h`
        : `${Math.round(seconds / 86400)} d`;

const shortDate = (iso: string) =>
  new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

/**
 * Admin console "System" segment: live settings (saved here or from `.env`),
 * maintenance mode and the running version against the latest commit.
 * Settings apply on every service within about 10 seconds, with no restart.
 */
export function AdminSystem({
  act,
  busy,
  onMaintenance,
}: {
  act: Act;
  busy: boolean;
  /** Called with the new state after maintenance is switched, for the app banner. */
  onMaintenance: (m: Maintenance) => void;
}) {
  const [view, setView] = useState<SystemSettingsView | null>(null);
  const [maintenance, setMaintenance] = useState<Maintenance | null>(null);
  const [failed, setFailed] = useState(false);

  const firstLoad = () =>
    act(async () => {
      setFailed(false);
      try {
        const [v, m] = await Promise.all([
          client.getSystemSettings(),
          client.getMaintenance(),
        ]);
        setView(v);
        setMaintenance(m);
      } catch (e) {
        setFailed(true);
        throw e;
      }
    });

  useEffect(() => {
    void firstLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!view || !maintenance)
    return failed ? (
      <View style={[shared.card, shared.empty]}>
        <Text style={shared.sectionTitle}>Couldn't load system settings.</Text>
        <Text style={[shared.subtitle, s.center, s.gapBelow]}>
          Check the error above, then try again.
        </Text>
        <Button
          secondary
          title="Try again"
          disabled={busy}
          style={s.flushButton}
          onPress={firstLoad}
        />
      </View>
    ) : (
      <Text style={shared.small}>Loading system settings…</Text>
    );

  return (
    <>
      <MaintenanceCard
        maintenance={maintenance}
        busy={busy}
        act={act}
        onChanged={(m) => {
          setMaintenance(m);
          onMaintenance(m);
        }}
      />
      {/* Keyed by the saved state so the form starts over after every save. */}
      <SettingsCard
        key={JSON.stringify(view)}
        view={view}
        busy={busy}
        act={act}
        onSaved={setView}
      />
      <VersionCard />
    </>
  );
}

// ---- Settings ----

/** Label row: the setting's name, where its value comes from and a reset. */
function FieldHead({
  label,
  source,
  busy,
  onReset,
}: {
  label: string;
  source: "database" | "environment";
  busy: boolean;
  onReset: () => void;
}) {
  const tone = SOURCE[source];
  return (
    <View style={s.fieldHead}>
      <Text style={[shared.label, s.fieldLabel]}>{label}</Text>
      <Pill label={tone.label} tone={tone.tone} />
      {source === "database" && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Reset ${label} to the .env value`}
          disabled={busy}
          hitSlop={8}
          onPress={onReset}
        >
          <Text style={[s.reset, busy && { opacity: 0.45 }]}>Reset</Text>
        </Pressable>
      )}
    </View>
  );
}

function SettingsCard({
  view,
  busy,
  act,
  onSaved,
}: {
  view: SystemSettingsView;
  busy: boolean;
  act: Act;
  onSaved: (view: SystemSettingsView) => void;
}) {
  const { settings, sources } = view;
  const [origins, setOrigins] = useState(settings.cors_origins.join("\n"));
  const [rate, setRate] = useState(String(settings.rate_limit_per_minute));
  const [lanes, setLanes] = useState(String(settings.notifier_concurrency));
  const [interval, setInterval_] = useState(
    String(Math.round(settings.status_interval_ms / 1000)),
  );
  const [host, setHost] = useState(settings.smtp.host);
  const [port, setPort] = useState(String(settings.smtp.port));
  const [smtpUser, setSmtpUser] = useState(settings.smtp.user);
  const [from, setFrom] = useState(settings.smtp.from);
  const [secure, setSecure] = useState(settings.smtp.secure);
  const [password, setPassword] = useState("");
  const [removePassword, setRemovePassword] = useState(false);
  const [sent, setSent] = useState("");

  const originList = origins
    .split("\n")
    .map((o) => o.trim())
    .filter(Boolean);
  const int = (v: string) => (/^\d+$/.test(v.trim()) ? Number(v) : NaN);
  const checks: [boolean, string][] = [
    [
      originList.length >= 1 && originList.length <= 20,
      "Add between 1 and 20 origins.",
    ],
    [int(rate) >= 0 && int(rate) <= 100000, "Rate limit is 0 to 100000."],
    [int(lanes) >= 1 && int(lanes) <= 64, "Reminder lanes are 1 to 64."],
    [
      int(interval) >= 5 && int(interval) <= 3600,
      "Status interval is 5 to 3600 seconds.",
    ],
    [int(port) >= 1 && int(port) <= 65535, "SMTP port is 1 to 65535."],
  ];
  const problem = checks.find(([ok]) => !ok)?.[1] ?? "";

  // Only what changed, so untouched settings keep following `.env`.
  const body: SystemSettingsUpdate = {};
  if (!problem) {
    if (originList.join("\n") !== settings.cors_origins.join("\n"))
      body.cors_origins = originList;
    if (int(rate) !== settings.rate_limit_per_minute)
      body.rate_limit_per_minute = int(rate);
    if (int(lanes) !== settings.notifier_concurrency)
      body.notifier_concurrency = int(lanes);
    if (int(interval) !== Math.round(settings.status_interval_ms / 1000))
      body.status_interval_ms = int(interval) * 1000;
    const smtp: NonNullable<SystemSettingsUpdate["smtp"]> = {};
    if (host.trim() !== settings.smtp.host) smtp.host = host.trim();
    if (int(port) !== settings.smtp.port) smtp.port = int(port);
    if (smtpUser.trim() !== settings.smtp.user) smtp.user = smtpUser.trim();
    if (from.trim() !== settings.smtp.from) smtp.from = from.trim();
    if (secure !== settings.smtp.secure) smtp.secure = secure;
    // Omitted keeps the saved password; "" removes it.
    if (removePassword) smtp.password = "";
    else if (password) smtp.password = password;
    if (Object.keys(smtp).length) body.smtp = smtp;
  }
  const dirty = Object.keys(body).length > 0;

  const save = () =>
    act(async () => {
      const next = await client.updateSystemSettings(body);
      // Never keep a password around after it has been sent.
      setPassword("");
      onSaved(next);
    });
  const reset = (key: SystemSettingKey) =>
    act(async () =>
      onSaved(await client.updateSystemSettings({ reset: [key] })),
    );

  const input = (
    value: string,
    onChange: (v: string) => void,
    label: string,
    extra: React.ComponentProps<typeof TextInput> = {},
  ) => (
    <TextInput
      style={[shared.input, s.input]}
      value={value}
      onChangeText={onChange}
      placeholderTextColor={colors.faint}
      autoCapitalize="none"
      autoCorrect={false}
      accessibilityLabel={label}
      {...extra}
    />
  );

  return (
    <FadeIn index={1} style={shared.card}>
      <Text style={shared.sectionTitle}>Settings</Text>
      <Text style={[shared.small, s.gapBelow]}>
        Changes apply on every service within about 10 seconds, with no restart.
        Reset returns a setting to its .env value.
      </Text>

      <FieldHead
        label="Allowed origins"
        source={sources.cors_origins}
        busy={busy}
        onReset={() => reset("cors_origins")}
      />
      {input(origins, setOrigins, "Allowed origins", {
        multiline: true,
        placeholder: "https://app.example.com",
        keyboardType: "url",
        style: [shared.input, s.input, s.multiline],
      })}
      <Text style={[shared.small, s.hint]}>
        Browser origins that may call the API, one per line.
      </Text>

      <FieldHead
        label="Rate limit per minute"
        source={sources.rate_limit_per_minute}
        busy={busy}
        onReset={() => reset("rate_limit_per_minute")}
      />
      {input(rate, setRate, "Rate limit per minute", {
        keyboardType: "number-pad",
      })}
      <Text style={[shared.small, s.hint]}>
        Requests per client per instance. 0 leaves it to the gateway.
      </Text>

      <FieldHead
        label="Reminder lanes"
        source={sources.notifier_concurrency}
        busy={busy}
        onReset={() => reset("notifier_concurrency")}
      />
      {input(lanes, setLanes, "Reminder lanes", {
        keyboardType: "number-pad",
      })}
      <Text style={[shared.small, s.hint]}>
        Reminders each notifier delivers at the same time.
      </Text>

      <FieldHead
        label="Status check interval (seconds)"
        source={sources.status_interval_ms}
        busy={busy}
        onReset={() => reset("status_interval_ms")}
      />
      {input(interval, setInterval_, "Status check interval in seconds", {
        keyboardType: "number-pad",
      })}
      <Text style={[shared.small, s.hint]}>
        How often the status page checks every service.
      </Text>

      <View style={s.divider} />
      <FieldHead
        label="Email (SMTP)"
        source={sources.smtp}
        busy={busy}
        onReset={() => reset("smtp")}
      />
      <Text style={[shared.small, s.hint]}>
        Leave the host empty to turn email reminders off.
      </Text>
      <Text style={shared.label}>Host</Text>
      {input(host, setHost, "SMTP host", { placeholder: "smtp.example.com" })}
      <View style={s.pair}>
        <View style={{ flex: 1 }}>
          <Text style={shared.label}>Port</Text>
          {input(port, setPort, "SMTP port", { keyboardType: "number-pad" })}
        </View>
        <View style={s.secure}>
          <Text style={shared.label}>TLS</Text>
          <Switch
            value={secure}
            disabled={busy}
            trackColor={{ true: colors.accent }}
            accessibilityLabel="Use TLS for SMTP"
            onValueChange={setSecure}
          />
        </View>
      </View>
      <Text style={shared.label}>Username</Text>
      {input(smtpUser, setSmtpUser, "SMTP username")}
      <Text style={shared.label}>From address</Text>
      {input(from, setFrom, "From address", {
        placeholder: "Orbyn <reminders@example.com>",
        keyboardType: "email-address",
      })}
      <Text style={shared.label}>Password</Text>
      {input(
        password,
        (v) => {
          setPassword(v);
          if (v) setRemovePassword(false);
        },
        "SMTP password",
        {
          editable: !removePassword,
          secureTextEntry: true,
          autoComplete: "off",
          textContentType: "none",
          placeholder: removePassword
            ? "Saved password will be removed"
            : settings.smtp.has_password
              ? "Leave blank to keep the saved password"
              : "Optional",
        },
      )}
      {settings.smtp.has_password && (
        <View style={s.keyRow}>
          <Text style={[shared.small, { flex: 1 }]}>
            {removePassword
              ? "The saved password is removed when you save."
              : password
                ? "The saved password is replaced when you save."
                : "A password is saved."}
          </Text>
          <SmallAction
            destructive={!removePassword}
            label={removePassword ? "Keep saved password" : "Remove password"}
            disabled={busy}
            onPress={() => {
              setPassword("");
              setRemovePassword((v) => !v);
            }}
          />
        </View>
      )}

      {!!problem && (
        <Text style={[shared.small, s.problem]} accessibilityRole="alert">
          {problem}
        </Text>
      )}
      <Button title="Save settings" disabled={busy || !dirty} onPress={save} />

      <View style={s.divider} />
      <Text style={shared.label}>Test email</Text>
      <Text style={[shared.small, s.hint]}>
        Sends a message to your admin address with the saved settings. On a
        local setup it arrives in the Mailpit test inbox.
      </Text>
      {!!sent && (
        <Text
          accessibilityLiveRegion="polite"
          style={[s.result, { color: colors.accent }]}
        >
          {sent}
        </Text>
      )}
      <View style={s.actions}>
        <SmallAction
          label="Send test email"
          disabled={busy || dirty}
          onPress={() =>
            act(async () => {
              setSent("");
              const r = await client.sendTestEmail();
              setSent(`Sent to ${r.to}.`);
            })
          }
        />
      </View>
      {dirty && (
        <Text style={shared.small}>Save your changes before testing.</Text>
      )}
    </FadeIn>
  );
}

// ---- Maintenance ----

function MaintenanceCard({
  maintenance,
  busy,
  act,
  onChanged,
}: {
  maintenance: Maintenance;
  busy: boolean;
  act: Act;
  onChanged: (m: Maintenance) => void;
}) {
  const [message, setMessage] = useState(maintenance.message);
  /** Minutes from now for the end time; null keeps the saved one. */
  const [minutes, setMinutes] = useState<number | null>(null);
  const on = maintenance.enabled;

  const until = () =>
    minutes === null
      ? maintenance.until
      : minutes === 0
        ? null
        : new Date(Date.now() + minutes * 60_000).toISOString();

  const send = (enabled: boolean) =>
    act(async () => {
      const next = await client.setMaintenance({
        enabled,
        message: message.trim(),
        until: enabled ? until() : null,
      });
      setMinutes(null);
      setMessage(next.message);
      onChanged(next);
    });

  const toggle = (enabled: boolean) =>
    Alert.alert(
      enabled ? "Turn on maintenance mode?" : "Turn off maintenance mode?",
      enabled
        ? "Members can still view everything, but their changes are refused until you turn it off. Admins can keep working."
        : "Members can make changes again straight away.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: enabled ? "Turn on" : "Turn off",
          style: enabled ? "destructive" : "default",
          onPress: () => void send(enabled),
        },
      ],
    );

  const edited =
    message.trim() !== maintenance.message.trim() || minutes !== null;

  return (
    <FadeIn style={shared.card}>
      <View style={s.cardHead}>
        <Text style={[shared.sectionTitle, { flex: 1 }]}>Maintenance</Text>
        <Switch
          value={on}
          disabled={busy}
          trackColor={{ true: colors.danger }}
          accessibilityLabel="Maintenance mode"
          onValueChange={toggle}
        />
      </View>
      <View style={s.statusRow}>
        <Pill label={on ? "On" : "Off"} tone={on ? "warning" : "muted"} />
        <Text style={[shared.small, { flex: 1 }]}>
          {on
            ? maintenance.until
              ? `Members can't make changes. Expected back ${formatUntil(maintenance.until)}.`
              : "Members can't make changes."
            : "Everyone can make changes."}
        </Text>
      </View>

      <Text style={shared.label}>Message</Text>
      <TextInput
        style={[shared.input, s.input, s.multiline]}
        value={message}
        onChangeText={setMessage}
        multiline
        maxLength={500}
        placeholder="We're upgrading the database. Back shortly."
        placeholderTextColor={colors.faint}
        accessibilityLabel="Maintenance message"
      />
      <Text style={shared.label}>Expected to end</Text>
      <View style={s.chips}>
        {UNTIL_CHOICES.map((c) => {
          const selected =
            minutes === null
              ? c.minutes === 0 && !maintenance.until
              : minutes === c.minutes;
          return (
            <Pressable
              key={c.label}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              onPress={() => setMinutes(c.minutes)}
              style={[s.chip, selected && s.chipActive]}
            >
              <Text style={[s.chipText, selected && s.chipTextActive]}>
                {c.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={[shared.small, s.hint]}>
        {minutes === null
          ? maintenance.until
            ? `Saved: ${formatUntil(maintenance.until)}`
            : "Shown to members with the message."
          : minutes === 0
            ? "No end time is shown."
            : `Ends around ${shortDate(until() as string)}.`}
      </Text>
      {on && (
        <Button
          secondary
          title="Update notice"
          disabled={busy || !edited}
          style={s.flushButton}
          onPress={() => void send(true)}
        />
      )}
    </FadeIn>
  );
}

// ---- Version ----

function VersionCard() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [version, setVersion] = useState<VersionInfo | null>(null);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);

  // Kept out of `act`: a GitHub hiccup belongs on this card, not the sheet.
  const check = async () => {
    setChecking(true);
    setError("");
    try {
      const next = await client.getUpdates();
      setInfo(next);
      setVersion(next.current);
    } catch (e) {
      setError(errorText(e));
      try {
        setVersion(await client.getVersion());
      } catch {
        // The error above already explains it.
      }
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    void check();
  }, []);

  const pill = !info
    ? null
    : !info.checks_enabled
      ? { label: "Checks off", tone: "muted" as const }
      : info.available
        ? { label: "Update available", tone: "warning" as const }
        : info.latest
          ? { label: "Up to date", tone: "accent" as const }
          : null;

  return (
    <FadeIn index={2} style={shared.card}>
      <View style={s.cardHead}>
        <Text style={[shared.sectionTitle, { flex: 1 }]}>
          Version and updates
        </Text>
        {pill && <Pill label={pill.label} tone={pill.tone} />}
      </View>
      {!version && !error && (
        <Text style={shared.small}>Checking the running version…</Text>
      )}
      {version && (
        <>
          <View style={s.kv}>
            <Text style={shared.small}>Running</Text>
            <Text style={s.kvValue} numberOfLines={1}>
              {version.version}
            </Text>
          </View>
          {version.built_at && (
            <View style={s.kv}>
              <Text style={shared.small}>Built</Text>
              <Text style={s.kvValue}>{shortDate(version.built_at)}</Text>
            </View>
          )}
          <View style={s.kv}>
            <Text style={shared.small}>Up for</Text>
            <Text style={s.kvValue}>{shortDuration(version.uptime_s)}</Text>
          </View>
        </>
      )}
      {info?.latest && (
        <View style={s.kv}>
          <Text style={shared.small}>Latest</Text>
          <Text style={s.kvValue} numberOfLines={1}>
            {info.latest.version} · {shortDate(info.latest.date)}
          </Text>
        </View>
      )}
      {!!info?.latest?.message && (
        <Text style={[shared.body, s.commit]} numberOfLines={3}>
          {info.latest.message}
        </Text>
      )}
      {info && !info.checks_enabled && (
        <Text style={[shared.small, s.hint]}>
          No repository is set for update checks.
        </Text>
      )}
      {!!(error || info?.error) && (
        <Text style={[shared.small, s.problem]}>{error || info?.error}</Text>
      )}
      <View style={s.actions}>
        <SmallAction
          label={checking ? "Checking…" : "Check again"}
          disabled={checking}
          onPress={() => void check()}
        />
        {info?.latest?.url && (
          <SmallAction
            label="View commit"
            disabled={false}
            onPress={() => void Linking.openURL(info.latest!.url)}
          />
        )}
      </View>
      {info?.deploy_url && (
        <Button
          secondary={!info.available}
          title="Open deploy workflow"
          icon="arrowRight"
          style={s.flushButton}
          onPress={() => void Linking.openURL(info.deploy_url!)}
        />
      )}
    </FadeIn>
  );
}

const s = themed(() =>
  StyleSheet.create({
    center: { textAlign: "center" },
    gapBelow: { marginTop: 4, marginBottom: 14 },
    flushButton: { marginTop: 4, marginBottom: 0 },
    cardHead: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginBottom: 8,
    },
    statusRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginBottom: 14,
    },
    fieldHead: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginBottom: 8,
    },
    fieldLabel: { flex: 1, marginBottom: 0 },
    reset: { fontFamily: fonts.semibold, fontSize: 13, color: colors.accent },
    input: { marginBottom: 6 },
    multiline: { minHeight: 76, textAlignVertical: "top", paddingTop: 13 },
    hint: { marginBottom: 14 },
    pair: { flexDirection: "row", gap: 12 },
    secure: { alignItems: "flex-start", marginBottom: 6 },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
      marginVertical: 14,
    },
    keyRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginBottom: 14,
    },
    problem: { color: colors.danger, marginBottom: 10 },
    result: {
      fontFamily: fonts.medium,
      fontSize: 13,
      lineHeight: 19,
      marginBottom: 10,
    },
    actions: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginBottom: 8,
    },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 },
    chip: {
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      paddingHorizontal: 11,
      paddingVertical: 6,
    },
    chipActive: {
      backgroundColor: colors.accentSoft,
      borderColor: colors.softBorder,
    },
    chipText: {
      fontFamily: fonts.medium,
      fontSize: 13,
      color: colors.textSoft,
    },
    chipTextActive: { color: colors.accent, fontFamily: fonts.semibold },
    kv: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      paddingVertical: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    kvValue: {
      flexShrink: 1,
      fontFamily: fonts.medium,
      fontSize: 15,
      color: colors.text,
    },
    commit: { marginTop: 4, marginBottom: 10 },
  }),
);
