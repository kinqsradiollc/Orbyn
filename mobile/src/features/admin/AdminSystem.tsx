import React, { useEffect, useRef, useState } from "react";
import { Linking, StyleSheet, Text, TextInput, View } from "react-native";
import { Alert } from "../../lib/alert";
import { Switch } from "../../components/Switch";
import type {
  Maintenance,
  SystemSettingKey,
  SystemSettingsUpdate,
  SystemSettingsView,
  UpdateInfo,
  VersionInfo,
} from "@orbyn/core";
import { InlineDetails } from "../../components/InlineDetails";
import { Button } from "../../components/Button";
import { formatUntil } from "../../components/MaintenanceBanner";
import { Pill } from "../../components/Pill";
import { SmallAction } from "../../components/SmallAction";
import { session } from "../../lib/session";
import { client } from "../../lib/api";
import { Pressable } from "../../motion";
import { colors, fonts, radii, themed } from "../../theme";
import { shared } from "../../styles";
import { errorText } from "../../lib/errors";

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

  const account = session.token;
  const mounted = useRef(true);
  const request = useRef(0);
  const mutation = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current++;
    };
  }, []);
  const current = () => mounted.current && session.token === account;
  const ownedAct: Act = async (fn) => {
    if (!current() || mutation.current) return;
    mutation.current = true;
    try {
      await act(async () => {
        if (current()) await fn();
      });
    } finally {
      mutation.current = false;
    }
  };
  const firstLoad = () =>
    ownedAct(async () => {
      const ticket = ++request.current;
      setFailed(false);
      try {
        const [v, m] = await Promise.all([
          client.getSystemSettings(),
          client.getMaintenance(),
        ]);
        if (!current() || ticket !== request.current) return;
        setView(v);
        setMaintenance(m);
      } catch (e) {
        if (!current() || ticket !== request.current) return;
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
        act={ownedAct}
        onChanged={(m) => {
          if (!current()) return;
          setMaintenance(m);
          onMaintenance(m);
        }}
      />
      {/* Keyed by the saved state so the form starts over after every save. */}
      <SettingsCard
        key={JSON.stringify(view)}
        view={view}
        busy={busy}
        act={ownedAct}
        onSaved={(next) => {
          if (current()) {
            request.current++;
            setView(next);
          }
        }}
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
  const account = session.token;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const current = () => mounted.current && session.token === account;
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
      if (!current()) return;
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
      editable={!busy}
      {...extra}
    />
  );

  return (
    <View style={shared.card}>
      <Text style={shared.sectionTitle}>Settings</Text>
      <Text style={[shared.small, s.gapBelow]}>
        Applies within 10 seconds. Reset uses .env.
      </Text>

      <FieldHead
        label="Allowed origins"
        source={sources.cors_origins}
        busy={busy || dirty}
        onReset={() => reset("cors_origins")}
      />
      {input(origins, setOrigins, "Allowed origins", {
        multiline: true,
        placeholder: "https://app.example.com",
        keyboardType: "url",
        style: [shared.input, s.input, s.multiline],
      })}
      <Text style={[shared.small, s.hint]}>One API origin per line.</Text>

      <FieldHead
        label="Rate limit per minute"
        source={sources.rate_limit_per_minute}
        busy={busy || dirty}
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
        busy={busy || dirty}
        onReset={() => reset("notifier_concurrency")}
      />
      {input(lanes, setLanes, "Reminder lanes", {
        keyboardType: "number-pad",
      })}
      <Text style={[shared.small, s.hint]}>
        Concurrent deliveries per notifier.
      </Text>

      <FieldHead
        label="Status check interval (seconds)"
        source={sources.status_interval_ms}
        busy={busy || dirty}
        onReset={() => reset("status_interval_ms")}
      />
      {input(interval, setInterval_, "Status check interval in seconds", {
        keyboardType: "number-pad",
      })}
      <Text style={[shared.small, s.hint]}>Time between service checks.</Text>

      <View style={s.divider} />
      <InlineDetails
        title="Email delivery"
        reveal={int(port) < 1 || int(port) > 65535 || Number.isNaN(int(port))}
      >
        <FieldHead
          label="Email (SMTP)"
          source={sources.smtp}
          busy={busy || dirty}
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
            editable: !busy && !removePassword,
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
      </InlineDetails>

      {!!problem && (
        <Text style={[shared.small, s.problem]} accessibilityRole="alert">
          {problem}
        </Text>
      )}
      <Button title="Save settings" disabled={busy || !dirty} onPress={save} />
      {dirty && (
        <Text style={shared.small}>Save changes before resetting a field.</Text>
      )}

      <View style={s.divider} />
      <InlineDetails title="Test email delivery">
        <Text style={shared.label}>Test email</Text>
        <Text style={[shared.small, s.hint]}>
          Uses saved settings and sends to your admin address.
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
                if (current()) setSent(`Sent to ${r.to}.`);
              })
            }
          />
        </View>
        {dirty && (
          <Text style={shared.small}>Save your changes before testing.</Text>
        )}
      </InlineDetails>
    </View>
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
  const account = session.token;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const current = () => mounted.current && session.token === account;
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
      if (!current()) return;
      setMinutes(null);
      setMessage(next.message);
      onChanged(next);
    });

  const toggle = (enabled: boolean) =>
    Alert.alert(
      enabled ? "Turn on maintenance mode?" : "Turn off maintenance mode?",
      enabled
        ? "Members can view but cannot make changes. Admins can keep working."
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
    <View style={shared.card}>
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

      <InlineDetails title="Maintenance notice">
        <Text style={shared.label}>Message</Text>
        <TextInput
          style={[shared.input, s.input, s.multiline]}
          editable={!busy}
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
                accessibilityState={{ checked: selected, disabled: busy }}
                disabled={busy}
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
              : `Expected back ${shortDate(until() as string)}.`}
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
      </InlineDetails>
    </View>
  );
}

// ---- Version ----

function VersionCard() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [version, setVersion] = useState<VersionInfo | null>(null);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);

  const mounted = useRef(true);
  const pending = useRef(false);
  const account = session.token;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const current = () => mounted.current && session.token === account;

  // Kept out of `act`: a GitHub hiccup belongs on this card, not the sheet.
  const check = async () => {
    if (!current() || pending.current) return;
    pending.current = true;
    setChecking(true);
    setError("");
    try {
      const next = await client.getUpdates();
      if (!current()) return;
      setInfo(next);
      setVersion(next.current);
    } catch (e) {
      if (!current()) return;
      setError(errorText(e));
      try {
        const fallback = await client.getVersion();
        if (current()) setVersion(fallback);
      } catch {
        // The error above already explains it.
      }
    } finally {
      pending.current = false;
      if (current()) setChecking(false);
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
    <View style={shared.card}>
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
            <Text style={s.kvValue}>{version.version}</Text>
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
          <Text style={s.kvValue}>
            {info.latest.version} · {shortDate(info.latest.date)}
          </Text>
        </View>
      )}
      {!!info?.latest?.message && (
        <InlineDetails title="Commit message">
          <Text selectable style={[shared.body, s.commit]}>
            {info.latest.message}
          </Text>
        </InlineDetails>
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
    </View>
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
      flexWrap: "wrap",
      alignItems: "center",
      gap: 8,
      marginBottom: 8,
    },
    fieldLabel: { flex: 1, minWidth: 100, marginBottom: 0 },
    reset: {
      minHeight: 44,
      textAlignVertical: "center",
      paddingVertical: 12,
      fontFamily: fonts.semibold,
      fontSize: 13,
      color: colors.accent,
    },
    input: { marginBottom: 6 },
    multiline: {
      minHeight: 76,
      maxHeight: 160,
      textAlignVertical: "top",
      paddingTop: 13,
    },
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
      minHeight: 44,
      justifyContent: "center",
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
      flexWrap: "wrap",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      paddingVertical: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    kvValue: {
      flexShrink: 1,
      minWidth: 0,
      fontFamily: fonts.medium,
      fontSize: 15,
      color: colors.text,
    },
    commit: { marginTop: 4, marginBottom: 10 },
  }),
);
