import React, { useCallback, useEffect, useState } from "react";
import {
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type {
  AdminAnalytics,
  AdminUserDetail,
  Announcement,
  RequestLogRow,
  RequestSummary,
  SweepView,
} from "@orbyn/core";
import { Chip, ChipRow } from "../components/Chip";
import { Icon } from "../components/Icon";
import { Segmented } from "../components/Segmented";
import { SmallAction } from "../components/SmallAction";
import { client } from "../lib/api";
import { saveFile } from "../lib/download";
import { confirmAction } from "../lib/confirm";
import { colors, fonts, radii, themed } from "../theme";
import { shared } from "../styles";

type Act = (fn: () => Promise<void>) => Promise<void>;

const SERVICE: Record<string, string> = {
  all: "All-in-one",
  api: "API",
  ai: "Assistant",
  realtime: "Realtime",
  status: "Status",
};
const ms = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${n} ms`;
const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString([], {
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
      })
    : "—";

/** Columns for a phone: one per period, errors drawn over requests. */
export function MiniBars({
  data,
  height = 72,
}: {
  data: { key: string; value: number; secondary?: number }[];
  height?: number;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <View
      style={[s.bars, { height }]}
      accessibilityLabel={`${data.reduce((n, d) => n + d.value, 0)} in total`}
    >
      {data.map((d) => (
        <View key={d.key} style={s.barCol}>
          <View
            style={[
              s.bar,
              { height: `${Math.max(2, (d.value / max) * 100)}%` },
            ]}
          >
            {!!d.secondary && (
              <View
                style={[
                  s.barErr,
                  {
                    height: `${Math.min(100, (d.secondary / Math.max(1, d.value)) * 100)}%`,
                  },
                ]}
              />
            )}
          </View>
        </View>
      ))}
    </View>
  );
}

// ---- Requests --------------------------------------------------------------

/** How the services are answering, and the request log, on a phone. */
export function AdminRequests({ act, busy }: { act: Act; busy: boolean }) {
  const [hours, setHours] = useState<"1" | "24" | "168">("24");
  const [summary, setSummary] = useState<RequestSummary | null>(null);
  const [status, setStatus] = useState<"" | "4xx" | "5xx">("");
  const [slow, setSlow] = useState(false);
  const [route, setRoute] = useState("");
  const [rows, setRows] = useState<RequestLogRow[] | null>(null);
  const [more, setMore] = useState(false);
  const [open, setOpen] = useState<number | null>(null);

  const loadRows = useCallback(
    async (before?: number) => {
      const page = await client.adminRequests({
        status: status || undefined,
        slow: slow || undefined,
        route: route.trim() || undefined,
        before,
        limit: 30,
      });
      setRows((was) => (before && was ? [...was, ...page.rows] : page.rows));
      setMore(page.more);
    },
    [status, slow, route],
  );
  useEffect(() => {
    void act(async () =>
      setSummary(await client.adminRequestSummary(Number(hours))),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hours]);
  useEffect(() => {
    const t = setTimeout(() => void act(() => loadRows()), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadRows]);

  return (
    <View style={s.stack}>
      <Segmented
        accessibilityLabel="Period"
        options={["1", "24", "168"] as ("1" | "24" | "168")[]}
        labels={{ "1": "Last hour", "24": "24 hours", "168": "7 days" }}
        value={hours}
        onChange={setHours}
      />
      {summary?.services.map((sv) => {
        const rate = sv.requests ? sv.server_errors / sv.requests : 0;
        return (
          <View key={sv.service} style={[shared.card, s.flat]}>
            <View style={s.rowBetween}>
              <Text style={s.title}>{SERVICE[sv.service] ?? sv.service}</Text>
              <Text
                style={[
                  s.pill,
                  rate > 0.05 ? s.pillBad : rate > 0 ? s.pillWarn : s.pillOk,
                ]}
              >
                {rate > 0.05 ? "Failing" : rate > 0 ? "Some errors" : "Healthy"}
              </Text>
            </View>
            <View style={s.facts}>
              <Fact label="Requests" value={sv.requests.toLocaleString()} />
              <Fact
                label="Server errors"
                value={`${sv.server_errors} (${(rate * 100).toFixed(1)}%)`}
              />
              <Fact
                label="p50 · p95"
                value={`${ms(sv.p50_ms)} · ${ms(sv.p95_ms)}`}
              />
              <Fact label="Copies" value={String(sv.instances)} />
            </View>
          </View>
        );
      })}
      {summary && summary.services.length === 0 && (
        <Text style={shared.small}>
          No requests recorded in this period yet.
        </Text>
      )}
      {summary && summary.timeline.length > 1 && (
        <View style={[shared.card, s.flat]}>
          <Text style={s.title}>Requests per hour</Text>
          <MiniBars
            data={summary.timeline.map((t) => ({
              key: t.hour,
              value: t.requests,
              secondary: t.server_errors,
            }))}
          />
        </View>
      )}

      <Text style={[shared.eyebrow, s.eyebrow]}>REQUEST LOG</Text>
      <TextInput
        style={shared.input}
        value={route}
        onChangeText={setRoute}
        placeholder="Route, e.g. /items"
        placeholderTextColor={colors.faint}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="Filter by route"
      />
      <ChipRow label="Filter the log">
        <Chip
          label="All"
          selected={!status && !slow}
          onPress={() => {
            setStatus("");
            setSlow(false);
          }}
        />
        <Chip
          label="Refused (4xx)"
          selected={status === "4xx"}
          onPress={() => setStatus(status === "4xx" ? "" : "4xx")}
        />
        <Chip
          label="Failed (5xx)"
          selected={status === "5xx"}
          onPress={() => setStatus(status === "5xx" ? "" : "5xx")}
        />
        <Chip label="Slow" selected={slow} onPress={() => setSlow(!slow)} />
      </ChipRow>
      <View style={s.list}>
        {rows?.length === 0 && (
          <Text style={[shared.small, s.pad]}>No requests match.</Text>
        )}
        {rows?.map((r, n) => (
          <Pressable
            key={r.id}
            accessibilityRole="button"
            accessibilityState={{ expanded: open === r.id }}
            onPress={() => setOpen(open === r.id ? null : r.id)}
            style={({ pressed }) => [
              s.logRow,
              n > 0 && s.divided,
              pressed && { backgroundColor: colors.surfaceMuted },
            ]}
          >
            <View style={s.rowBetween}>
              <Text style={s.code} numberOfLines={1}>
                {r.method} {r.route}
              </Text>
              <Text
                style={[
                  s.pill,
                  r.status >= 500
                    ? s.pillBad
                    : r.status >= 400
                      ? s.pillWarn
                      : s.pillOk,
                ]}
              >
                {r.status}
              </Text>
            </View>
            <Text style={shared.small} numberOfLines={1}>
              {when(r.at)} · {ms(r.duration_ms)} ·{" "}
              {SERVICE[r.service] ?? r.service}
              {r.user_email ? ` · ${r.user_email}` : ""}
            </Text>
            {open === r.id && (
              <Text style={[shared.small, s.detail]} selectable>
                Request id {r.request_id || "—"}
                {"\n"}Copy {r.instance || "—"}
              </Text>
            )}
          </Pressable>
        ))}
      </View>
      {more && rows && (
        <SmallAction
          label="Show older"
          disabled={busy}
          onPress={() => void act(() => loadRows(rows[rows.length - 1].id))}
        />
      )}
    </View>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.fact}>
      <Text style={s.factLabel}>{label}</Text>
      <Text style={s.factValue}>{value}</Text>
    </View>
  );
}

// ---- Analytics -------------------------------------------------------------

export function AdminAnalyticsView({ act }: { act: Act }) {
  const [days, setDays] = useState<"7" | "30" | "90">("30");
  const [data, setData] = useState<AdminAnalytics | null>(null);
  useEffect(() => {
    void act(async () => setData(await client.adminAnalytics(Number(days))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);
  const t = data?.totals;
  const tiles: [string, number | undefined][] = [
    ["Active today", t?.active_today],
    ["Active this week", t?.active_7_days],
    ["Active this month", t?.active_30_days],
    ["New accounts", t?.signups],
    ["Items created", t?.items_created],
    ["Tasks finished", t?.tasks_done],
    ["Assistant requests", t?.ai_requests],
    ["Focus hours", t ? Math.round(t.focus_minutes / 60) : undefined],
  ];
  const chart = (
    title: string,
    pick: (d: AdminAnalytics["series"][number]) => number,
  ) =>
    data && (
      <View style={[shared.card, s.flat]} key={title}>
        <View style={s.rowBetween}>
          <Text style={s.title}>{title}</Text>
          <Text style={shared.small}>
            {data.series.reduce((n, d) => n + pick(d), 0).toLocaleString()}
          </Text>
        </View>
        <MiniBars
          data={data.series.map((d) => ({ key: d.day, value: pick(d) }))}
        />
      </View>
    );
  return (
    <View style={s.stack}>
      <Segmented
        accessibilityLabel="Period"
        options={["7", "30", "90"] as ("7" | "30" | "90")[]}
        labels={{ "7": "7 days", "30": "30 days", "90": "90 days" }}
        value={days}
        onChange={setDays}
      />
      <View style={s.tiles}>
        {tiles.map(([label, value]) => (
          <View key={label} style={s.tile}>
            <Text style={s.tileValue}>
              {value === undefined ? "–" : value.toLocaleString()}
            </Text>
            <Text style={shared.small}>{label}</Text>
          </View>
        ))}
      </View>
      {chart("Active people", (d) => d.active_users)}
      {chart("Items created", (d) => d.items_created)}
      {chart("Tasks finished", (d) => d.tasks_done)}
      {chart("Assistant requests", (d) => d.ai_requests)}
      {data && data.most_active.length > 0 && (
        <View style={s.list}>
          <Text style={[shared.eyebrow, s.pad]}>MOST ACTIVE</Text>
          {data.most_active.map((p, n) => (
            <View key={p.user_id} style={[s.logRow, n > 0 && s.divided]}>
              <Text style={s.title}>{p.name}</Text>
              <Text style={shared.small}>
                {p.email} · {p.days_active} of {days} days
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ---- One account -----------------------------------------------------------

/** One account and what an admin can do for it, each asked first. */
export function AdminAccount({
  userId,
  meId,
  act,
  busy,
  onBack,
}: {
  userId: string;
  meId?: string;
  act: Act;
  busy: boolean;
  onBack: () => void;
}) {
  const [d, setD] = useState<AdminUserDetail | null>(null);
  const [editing, setEditing] = useState<{
    name: string;
    email: string;
  } | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const load = useCallback(
    () => act(async () => setD(await client.adminUserDetail(userId))),
    [act, userId],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const self = userId === meId;
  const then = (fn: () => Promise<unknown>) =>
    void act(async () => {
      await fn();
      setD(await client.adminUserDetail(userId));
    });

  return (
    <View style={s.stack}>
      <Pressable
        accessibilityRole="button"
        onPress={onBack}
        hitSlop={8}
        style={s.back}
      >
        <Icon name="chevronLeft" size={16} color={colors.accent} />
        <Text style={s.backText}>All users</Text>
      </Pressable>
      {!d ? (
        <Text style={shared.small}>Loading account…</Text>
      ) : (
        <>
          <View style={[shared.card, s.flat]}>
            {editing ? (
              <View style={s.stack}>
                <TextInput
                  style={shared.input}
                  value={editing.name}
                  onChangeText={(name) => setEditing({ ...editing, name })}
                  accessibilityLabel="Name"
                  maxLength={100}
                />
                <TextInput
                  style={shared.input}
                  value={editing.email}
                  onChangeText={(email) => setEditing({ ...editing, email })}
                  accessibilityLabel="Email"
                  autoCapitalize="none"
                  keyboardType="email-address"
                  maxLength={254}
                />
                <View style={s.actions}>
                  <SmallAction
                    label="Save"
                    disabled={
                      busy || !editing.name.trim() || !editing.email.trim()
                    }
                    onPress={() => {
                      const name = editing.name.trim();
                      const email = editing.email.trim().toLowerCase();
                      confirmAction(
                        `Save changes to ${d.email}?`,
                        [
                          name !== d.name ? `Name → ${name}` : "",
                          email !== d.email ? `Email → ${email}` : "",
                        ]
                          .filter(Boolean)
                          .join("\n") || "Nothing changed.",
                        "Save",
                        () =>
                          then(async () => {
                            await client.adminUpdateUserProfile(d.id, {
                              ...(name !== d.name ? { name } : {}),
                              ...(email !== d.email ? { email } : {}),
                            });
                            setEditing(null);
                          }),
                      );
                    }}
                  />
                  <SmallAction
                    label="Cancel"
                    disabled={busy}
                    onPress={() => setEditing(null)}
                  />
                </View>
              </View>
            ) : (
              <>
                <View style={s.rowBetween}>
                  <Text style={s.name}>
                    {d.name}
                    {self ? " (you)" : ""}
                  </Text>
                  <SmallAction
                    label="Edit"
                    disabled={busy}
                    onPress={() => setEditing({ name: d.name, email: d.email })}
                  />
                </View>
                <Text style={shared.small}>
                  {d.email} · {d.role === "admin" ? "Admin" : "Member"} ·{" "}
                  {d.disabled
                    ? "Disabled"
                    : d.email_verified
                      ? "Active"
                      : "Unverified"}
                </Text>
              </>
            )}
            <View style={s.facts}>
              <Fact label="Last active" value={when(d.last_active)} />
              <Fact
                label="Items"
                value={`${d.counts.items} (${d.counts.open_items} open)`}
              />
              <Fact
                label="Pages · projects"
                value={`${d.counts.docs} · ${d.counts.projects}`}
              />
              <Fact
                label="Sign-in"
                value={d.two_factor ? "Two-step on" : "Password only"}
              />
            </View>
          </View>

          <View style={[shared.card, s.flat]}>
            <Text style={s.title}>Account actions</Text>
            <View style={s.actions}>
              <SmallAction
                label="Sign out everywhere"
                disabled={busy || self || !d.sessions.length}
                onPress={() =>
                  confirmAction(
                    `Sign ${d.email} out on every device?`,
                    "They can sign straight back in with their password.",
                    "Sign out",
                    () => then(() => client.adminSignOutUser(d.id)),
                  )
                }
              />
              <SmallAction
                label="Password reset link"
                disabled={busy || d.disabled}
                onPress={() =>
                  confirmAction(
                    `Make a reset link for ${d.email}?`,
                    "It works once, for an hour.",
                    "Make link",
                    () =>
                      then(async () =>
                        setLink((await client.adminResetLink(d.id)).link),
                      ),
                  )
                }
              />
              <SmallAction
                label="Export their data"
                disabled={busy}
                onPress={() =>
                  confirmAction(
                    `Export ${d.email}'s data?`,
                    "Everything in their account, as a JSON file. This is recorded in the audit log.",
                    "Export",
                    () =>
                      then(async () =>
                        saveFile(
                          `orbyn-export-${d.email}.json`,
                          JSON.stringify(
                            await client.adminExportUser(d.id),
                            null,
                            2,
                          ),
                          "application/json",
                        ),
                      ),
                  )
                }
              />
              {d.two_factor && (
                <SmallAction
                  label="Turn off two-step"
                  destructive
                  disabled={busy}
                  onPress={() =>
                    confirmAction(
                      `Turn off two-step for ${d.email}?`,
                      "Only once you're sure it's really them.",
                      "Turn off",
                      () => then(() => client.adminResetTwoFactor(d.id)),
                    )
                  }
                />
              )}
            </View>
            {link && (
              <View style={s.linkBox}>
                <Text style={[shared.small, s.linkText]} selectable>
                  {link}
                </Text>
                <SmallAction
                  label="Share link"
                  disabled={false}
                  onPress={() =>
                    Platform.OS === "web"
                      ? void globalThis.navigator?.clipboard?.writeText(link)
                      : void Share.share({ message: link })
                  }
                />
                <Text style={shared.small}>
                  Works once, for an hour. Send it privately.
                </Text>
              </View>
            )}
          </View>

          <View style={s.list}>
            <Text style={[shared.eyebrow, s.pad]}>
              SIGNED IN · {d.sessions.length}
            </Text>
            {d.sessions.map((ss, n) => (
              <View
                key={ss.id}
                style={[s.logRow, s.rowBetween, n > 0 && s.divided]}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.title} numberOfLines={1}>
                    {ss.user_agent || "Unknown device"}
                  </Text>
                  <Text style={shared.small}>
                    Last seen {when(ss.last_seen_at)}
                  </Text>
                </View>
                {!self && (
                  <SmallAction
                    label="End"
                    destructive
                    disabled={busy}
                    onPress={() =>
                      confirmAction("End this session?", "", "End", () =>
                        then(() => client.adminEndSession(d.id, ss.id)),
                      )
                    }
                  />
                )}
              </View>
            ))}
          </View>

          {d.audit.length > 0 && (
            <View style={s.list}>
              <Text style={[shared.eyebrow, s.pad]}>HISTORY</Text>
              {d.audit.map((a, n) => (
                <View key={a.id} style={[s.logRow, n > 0 && s.divided]}>
                  <Text style={s.title}>
                    {a.action.replace("user.", "").replaceAll("_", " ")}
                  </Text>
                  <Text style={shared.small}>
                    {a.actor_email ?? "System"} · {when(a.created_at)}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </>
      )}
    </View>
  );
}

// ---- Retention and announcement (System) ------------------------------------

export function RetentionCard({ act, busy }: { act: Act; busy: boolean }) {
  const [view, setView] = useState<SweepView | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const show = (v: SweepView) => {
    setView(v);
    setDraft(
      Object.fromEntries(
        v.rules
          .filter((r) => r.configurable)
          .map((r) => [r.key, String(r.days ?? 0)]),
      ),
    );
  };
  useEffect(() => {
    void act(async () => show(await client.adminSweep()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!view) return null;
  const changed = view.rules.filter(
    (r) => r.configurable && String(r.days ?? 0) !== draft[r.key],
  );
  return (
    <View style={[shared.card, s.flat]}>
      <Text style={s.title}>Data retention</Text>
      <Text style={shared.small}>
        Records past their keep time are cleared every hour. 0 keeps forever.
        {view.last ? ` Last swept ${when(view.last.at)}.` : ""}
      </Text>
      {view.rules
        .filter((r) => r.configurable)
        .map((r) => (
          <View key={r.key} style={s.retRow}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={s.title}>{r.label}</Text>
              <Text style={shared.small}>
                {r.rows.toLocaleString()} {r.rows === 1 ? "row" : "rows"} ·{" "}
                {r.size}
              </Text>
            </View>
            <TextInput
              style={[shared.input, s.days]}
              value={draft[r.key]}
              onChangeText={(v) =>
                setDraft({ ...draft, [r.key]: v.replace(/\D/g, "") })
              }
              keyboardType="number-pad"
              accessibilityLabel={`Days to keep ${r.label}`}
            />
            <Text style={[shared.small, s.daysUnit]}>
              {Number(draft[r.key]) === 0 ? "forever" : "days"}
            </Text>
          </View>
        ))}
      <View style={s.actions}>
        <SmallAction
          label="Save"
          disabled={busy || !changed.length}
          onPress={() =>
            confirmAction(
              "Save how long records are kept?",
              "Anything older than a shorter keep time is removed at the next sweep.",
              "Save",
              () =>
                void act(async () =>
                  show(
                    await client.setRetention(
                      Object.fromEntries(
                        changed.map((r) => [r.key, Number(draft[r.key])]),
                      ),
                    ),
                  ),
                ),
            )
          }
        />
        <SmallAction
          label="Sweep now"
          disabled={busy}
          onPress={() => void act(async () => show(await client.runSweep()))}
        />
      </View>
    </View>
  );
}

export function AnnouncementCard({ act, busy }: { act: Act; busy: boolean }) {
  const [live, setLive] = useState<Announcement | null>(null);
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<"info" | "warning">("info");
  useEffect(() => {
    void act(async () => {
      const a = await client.announcement();
      setLive(a);
      if (a) {
        setMessage(a.message);
        setTone(a.tone);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const publish = (clear: boolean) =>
    confirmAction(
      clear ? "Remove the announcement?" : "Show this to everyone?",
      clear ? "" : message.trim(),
      clear ? "Remove" : "Publish",
      () =>
        void act(async () => {
          const saved = await client.setAnnouncement({
            message: clear ? "" : message.trim(),
            tone,
          });
          setLive(saved.message ? saved : null);
          if (clear) setMessage("");
        }),
    );
  return (
    <View style={[shared.card, s.flat]}>
      <Text style={s.title}>Announcement</Text>
      <Text style={shared.small}>
        Shown at the top of every app until removed.
      </Text>
      <TextInput
        style={[shared.input, s.multiline]}
        value={message}
        onChangeText={setMessage}
        placeholder="Planned update tonight at 10pm."
        placeholderTextColor={colors.faint}
        multiline
        maxLength={300}
        accessibilityLabel="Announcement message"
      />
      <ChipRow label="Tone">
        <Chip
          label="Information"
          selected={tone === "info"}
          onPress={() => setTone("info")}
        />
        <Chip
          label="Heads-up"
          selected={tone === "warning"}
          onPress={() => setTone("warning")}
        />
      </ChipRow>
      <View style={s.actions}>
        <SmallAction
          label={live ? "Update" : "Publish"}
          disabled={busy || !message.trim()}
          onPress={() => publish(false)}
        />
        {live && (
          <SmallAction
            label="Remove"
            destructive
            disabled={busy}
            onPress={() => publish(true)}
          />
        )}
      </View>
    </View>
  );
}

/** The admins' notice, at the top of Today, until dismissed. */
export function AnnouncementBanner() {
  const [notice, setNotice] = useState<Announcement | null>(null);
  const [hidden, setHidden] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      client.announcement().then(
        (a) => alive && setNotice(a),
        () => {},
      );
    void load();
    const id = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  if (!notice || hidden === notice.updated_at) return null;
  const warn = notice.tone === "warning";
  return (
    <View style={[s.banner, warn && s.bannerWarn]} accessibilityRole="summary">
      <Icon
        name="bell"
        size={15}
        color={warn ? colors.warningStrong : colors.accent}
      />
      <Text style={[s.bannerText, warn && { color: colors.warningStrong }]}>
        {notice.message}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        hitSlop={10}
        onPress={() => setHidden(notice.updated_at)}
      >
        <Icon name="x" size={15} color={colors.muted} />
      </Pressable>
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    stack: { gap: 12 },
    // The stack spaces these cards; the card's own margin would double it.
    flat: { marginBottom: 0 },
    rowBetween: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
    },
    title: { color: colors.text, fontFamily: fonts.semibold, fontSize: 14 },
    name: {
      color: colors.text,
      fontFamily: fonts.display,
      fontSize: 19,
      flexShrink: 1,
    },
    eyebrow: { marginTop: 8, marginBottom: 0 },
    pill: {
      overflow: "hidden",
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: radii.pill,
      fontFamily: fonts.semibold,
      fontSize: 11,
    },
    pillOk: { backgroundColor: colors.accentSoft, color: colors.accent },
    pillWarn: {
      backgroundColor: colors.warningSoft,
      color: colors.warningStrong,
    },
    pillBad: { backgroundColor: colors.dangerSoft, color: colors.danger },
    facts: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 10 },
    fact: { width: "46%", gap: 2 },
    factLabel: { color: colors.muted, fontFamily: fonts.regular, fontSize: 11 },
    factValue: { color: colors.text, fontFamily: fonts.semibold, fontSize: 14 },
    bars: {
      flexDirection: "row",
      alignItems: "flex-end",
      gap: 2,
      marginTop: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    barCol: { flex: 1, height: "100%", justifyContent: "flex-end" },
    bar: {
      justifyContent: "flex-end",
      borderTopLeftRadius: 3,
      borderTopRightRadius: 3,
      backgroundColor: colors.accent,
      opacity: 0.8,
      overflow: "hidden",
    },
    barErr: { backgroundColor: colors.danger },
    list: {
      overflow: "hidden",
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      backgroundColor: colors.surface,
    },
    pad: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 4 },
    logRow: { gap: 3, paddingHorizontal: 14, paddingVertical: 10 },
    divided: { borderTopWidth: 1, borderTopColor: colors.divider },
    code: {
      flex: 1,
      minWidth: 0,
      color: colors.text,
      fontFamily: fonts.medium,
      fontSize: 13,
    },
    detail: { marginTop: 4 },
    tiles: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    tile: {
      width: "48%",
      flexGrow: 1,
      gap: 2,
      padding: 12,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.input,
      backgroundColor: colors.surface,
    },
    tileValue: { color: colors.text, fontFamily: fonts.display, fontSize: 22 },
    back: { flexDirection: "row", alignItems: "center", gap: 4 },
    backText: { color: colors.accent, fontFamily: fonts.medium, fontSize: 14 },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
    linkBox: {
      gap: 6,
      marginTop: 10,
      padding: 10,
      borderRadius: radii.input,
      backgroundColor: colors.warningSoft,
      borderWidth: 1,
      borderColor: colors.warningBorder,
    },
    linkText: { color: colors.text },
    retRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingVertical: 8,
      borderTopWidth: 1,
      borderTopColor: colors.divider,
    },
    days: { width: 72, minHeight: 38, textAlign: "right", paddingVertical: 6 },
    daysUnit: { width: 48 },
    multiline: { minHeight: 72, paddingTop: 10, marginTop: 10 },
    banner: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginTop: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: radii.input,
      borderWidth: 1,
      borderColor: colors.softBorder,
      backgroundColor: colors.soft,
    },
    bannerWarn: {
      borderColor: colors.warningBorder,
      backgroundColor: colors.warningSoft,
    },
    bannerText: {
      flex: 1,
      color: colors.accent,
      fontFamily: fonts.medium,
      fontSize: 13,
    },
  }),
);
