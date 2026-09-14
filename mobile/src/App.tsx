import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  Modal,
  Alert,
  Switch,
  Platform,
  RefreshControl,
  KeyboardAvoidingView,
  AppState,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import * as SecureStore from "expo-secure-store";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import DateTimePicker from "@react-native-community/datetimepicker";
import {
  api,
  itemBody,
  type Item,
  type User,
  type Notice,
  type Proposal,
} from "./api";
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});
const dateLabel = (s: string | null) =>
  s
    ? new Date(s).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "Anytime";
const fresh = {
  title: "",
  notes: "",
  kind: "task" as const,
  status: "todo" as const,
  priority: "medium" as const,
  due_at: null,
  end_at: null,
  reminder_minutes: 30,
};
function Button({
  title,
  onPress,
  disabled = false,
  secondary = false,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[
        s.button,
        secondary && s.secondary,
        disabled && { opacity: 0.45 },
      ]}
    >
      <Text style={[s.buttonText, secondary && { color: "#456d4d" }]}>
        {title}
      </Text>
    </Pressable>
  );
}
function Screen() {
  const [token, setToken] = useState("");
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [tab, setTab] = useState("Today");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [register, setRegister] = useState(true);
  const [editing, setEditing] = useState<
    Item | Omit<Item, "id" | "version"> | null
  >(null);
  const [message, setMessage] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [search, setSearch] = useState("");
  const [picker, setPicker] = useState<{
    field: "due_at" | "end_at";
    mode: "date" | "time";
  } | null>(null);
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const refreshSeq = useRef(0);
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
      if ((e as { status?: number }).status === 401) {
        await SecureStore.deleteItemAsync("orbyn-session");
        setToken("");
        setItems([]);
        setNotices([]);
        setProposal(null);
        setUser(null);
      }
    } finally {
      setBusy(false);
    }
  };
  const refresh = useCallback(async () => {
    if (!token) return;
    const seq = ++refreshSeq.current;
    setRefreshing(true);
    try {
      const list: Item[] = [];
      for (let offset = 0; ; offset += 500) {
        const page = await api<Item[]>(
          `/items?limit=500&offset=${offset}`,
          token,
        );
        list.push(...page);
        if (page.length < 500) break;
      }
      const [u, n] = await Promise.all([
        api<User>("/me", token),
        api<Notice[]>("/notifications", token),
      ]);
      if (tokenRef.current !== token || seq !== refreshSeq.current) return;
      setItems(list);
      setUser(u);
      setNotices(n);
    } finally {
      if (tokenRef.current === token) setRefreshing(false);
    }
  }, [token]);
  useEffect(() => {
    SecureStore.getItemAsync("orbyn-session")
      .then((t) => setToken(t || ""))
      .catch(() => setError("Unable to restore your session"))
      .finally(() => setReady(true));
  }, []);
  useEffect(() => {
    if (!token) return;
    void act(refresh);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void act(refresh);
    });
    const notification = Notifications.addNotificationReceivedListener(() => {
      void act(refresh);
    });
    return () => {
      sub.remove();
      notification.remove();
    };
  }, [token, refresh]);
  const enablePush = () =>
    act(async () => {
      if (Platform.OS === "android")
        await Notifications.setNotificationChannelAsync("default", {
          name: "Planner reminders",
          importance: Notifications.AndroidImportance.HIGH,
        });
      const permission = await Notifications.requestPermissionsAsync();
      if (permission.status !== "granted")
        throw new Error(
          "Allow notifications in your device settings to receive reminders.",
        );
      const projectId =
        process.env.EXPO_PUBLIC_EAS_PROJECT_ID ||
        Constants.expoConfig?.extra?.eas?.projectId;
      if (!projectId)
        throw new Error(
          "Configure the Expo EAS project ID before enabling push notifications.",
        );
      const push = (await Notifications.getExpoPushTokenAsync({ projectId }))
        .data;
      await api("/devices", token, "POST", { token: push });
      await SecureStore.setItemAsync("orbyn-push", push);
      Alert.alert(
        "You’re in the loop",
        "Deadline reminders will reach this device.",
      );
    });
  const logout = () =>
    act(async () => {
      const push = await SecureStore.getItemAsync("orbyn-push");
      if (push) {
        await api("/devices", token, "DELETE", { token: push });
        await SecureStore.deleteItemAsync("orbyn-push");
      }
      await api("/auth/logout", token, "POST");
      await SecureStore.deleteItemAsync("orbyn-session");
      setToken("");
      setItems([]);
      setNotices([]);
      setProposal(null);
      setUser(null);
    });
  const ask = (text = message) =>
    act(async () => {
      setProposal(
        await api<Proposal>("/ai/chat", token, "POST", {
          message: text,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      );
      setMessage("");
    });
  if (!ready)
    return (
      <View style={s.center}>
        <Text style={s.logo}>◎ orbyn</Text>
        <Text>Finding your space…</Text>
      </View>
    );
  if (!token)
    return (
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={s.auth}>
          <Text style={s.logo}>◎ orbyn</Text>
          <Text style={s.eyebrow}>
            A LITTLE CLARITY. A LOT MORE POSSIBILITY.
          </Text>
          <Text style={s.hero}>Your life.{"\n"}In a better orbit.</Text>
          <Text style={s.subtitle}>
            {register
              ? "Create your space and make room for what matters."
              : "Welcome back. Your plans are right here."}
          </Text>
          {register && (
            <TextInput
              style={s.input}
              placeholder="Your name"
              value={name}
              onChangeText={setName}
              maxLength={80}
              autoComplete="name"
            />
          )}
          <TextInput
            style={s.input}
            placeholder="Email address"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
          />
          <TextInput
            style={s.input}
            placeholder="Password (at least 10 characters)"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            maxLength={128}
            autoComplete={register ? "new-password" : "current-password"}
          />
          {!!error && (
            <Text accessibilityRole="alert" style={s.error}>
              {error}
            </Text>
          )}
          <Button
            title={
              busy ? "One moment…" : register ? "Create your space" : "Sign in"
            }
            disabled={busy}
            onPress={() =>
              act(async () => {
                const result = await api<{ token: string; user: User }>(
                  `/auth/${register ? "register" : "login"}`,
                  "",
                  "POST",
                  { email, password, ...(register ? { name } : {}) },
                );
                await SecureStore.setItemAsync("orbyn-session", result.token);
                setToken(result.token);
                setUser(result.user);
                setPassword("");
              })
            }
          />
          <Button
            secondary
            title={
              register
                ? "Already have an account? Sign in"
                : "New here? Create an account"
            }
            onPress={() => {
              setRegister(!register);
              setError("");
            }}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    );
  const today = new Date();
  const visible = items
    .filter(
      (i) =>
        (i.title + " " + i.notes)
          .toLowerCase()
          .includes(search.toLowerCase()) &&
        (tab !== "Today" ||
          (i.status === "todo" &&
            !!i.due_at &&
            new Date(i.due_at).toDateString() === today.toDateString())),
    )
    .sort((a, b) => (a.due_at || "z").localeCompare(b.due_at || "z"));
  return (
    <View style={{ flex: 1 }}>
      <View style={s.header}>
        <Text style={s.logo}>◎ orbyn</Text>
        <Pressable
          accessibilityLabel="Add item"
          onPress={() => setEditing({ ...fresh })}
        >
          <Text style={s.add}>＋</Text>
        </Pressable>
      </View>
      <ScrollView
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => act(refresh)}
            tintColor="#476f4d"
          />
        }
      >
        <Text style={s.eyebrow}>
          {today
            .toLocaleDateString([], {
              weekday: "long",
              month: "long",
              day: "numeric",
            })
            .toUpperCase()}
        </Text>
        <Text style={s.title}>
          {tab === "Today"
            ? `Hello, ${user?.name.split(" ")[0] || "there"}.`
            : tab === "AI"
              ? "A mind beside yours."
              : tab}
        </Text>
        <Text style={s.subtitle}>
          {tab === "Today"
            ? "Let's make room for a good day."
            : tab === "Calendar"
              ? "Your upcoming days, in order."
              : "A little perspective on your personal orbit."}
        </Text>
        {!!error && (
          <Pressable onPress={() => setError("")}>
            <Text accessibilityRole="alert" style={s.error}>
              {error}
            </Text>
          </Pressable>
        )}
        {["Today", "Tasks", "Calendar"].includes(tab) && (
          <>
            <View style={s.stats}>
              <View>
                <Text style={s.statValue}>
                  {items.filter((i) => i.status === "todo").length}
                </Text>
                <Text style={s.small}>In your orbit</Text>
              </View>
              <View>
                <Text style={s.statValue}>
                  {items.filter((i) => i.status === "done").length}
                </Text>
                <Text style={s.small}>Completed</Text>
              </View>
            </View>
            {tab === "Tasks" && (
              <TextInput
                style={s.input}
                placeholder="Find something…"
                value={search}
                onChangeText={setSearch}
              />
            )}
            <Text style={s.sectionTitle}>
              {tab === "Today"
                ? "Today’s focus"
                : tab === "Calendar"
                  ? "Your agenda"
                  : "All your plans"}
            </Text>
            {visible
              .filter((i) => tab !== "Calendar" || i.due_at)
              .map((i) => (
                <View style={s.item} key={i.id}>
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: i.status === "done" }}
                    accessibilityLabel={"Complete " + i.title}
                    disabled={busy}
                    onPress={() =>
                      act(async () => {
                        await api(`/items/${i.id}`, token, "PUT", {
                          ...itemBody(i),
                          status: i.status === "done" ? "todo" : "done",
                        });
                        await refresh();
                      })
                    }
                  >
                    <Text
                      style={[
                        s.checkbox,
                        i.status === "done" && { color: "#476f4d" },
                      ]}
                    >
                      {i.status === "done" ? "☑" : "□"}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={{ flex: 1 }}
                    onPress={() => setEditing({ ...i })}
                  >
                    <Text
                      style={[
                        s.itemTitle,
                        i.status === "done" && {
                          textDecorationLine: "line-through",
                          color: "#9ba797",
                        },
                      ]}
                    >
                      {i.title}
                    </Text>
                    <Text style={s.small}>
                      {dateLabel(i.due_at)} · {i.kind} · {i.priority}
                    </Text>
                  </Pressable>
                  <Text style={s.arrow}>↗</Text>
                </View>
              ))}
            {!visible.length && (
              <View style={s.empty}>
                <Text style={s.emptyIcon}>☼</Text>
                <Text style={s.sectionTitle}>A little breathing room.</Text>
                <Text style={s.subtitle}>
                  Add something worth making time for.
                </Text>
                <Button
                  secondary
                  title="Make a plan"
                  onPress={() => setEditing({ ...fresh })}
                />
              </View>
            )}
            {tab === "Today" && (
              <View style={s.aiCard}>
                <Text style={s.eyebrow}>A MIND BESIDE YOURS</Text>
                <Text style={s.title}>Find your next clear step.</Text>
                <Text style={s.subtitle}>
                  Turn a busy mind into a plan that feels possible.
                </Text>
                <Button
                  secondary
                  title="Help me plan my day ↗"
                  onPress={() => {
                    setTab("AI");
                    void ask(
                      "Summarize my day and suggest what needs attention.",
                    );
                  }}
                />
              </View>
            )}
          </>
        )}
        {tab === "AI" && (
          <>
            <View style={s.aiCard}>
              <Text style={s.sectionTitle}>What’s on your mind?</Text>
              <Text style={s.subtitle}>
                Ask for a summary or changes to your plans. You review every
                change before it’s saved.
              </Text>
              <Button
                secondary
                title="Summarize my week ↗"
                disabled={busy}
                onPress={() => ask("Summarize my week")}
              />
            </View>
            {proposal && (
              <View style={s.card}>
                <Text style={s.body}>{proposal.summary}</Text>
                {proposal.actions.map((a, n) => (
                  <View key={n} style={s.action}>
                    <Text style={s.itemTitle}>
                      {a.operation.toUpperCase()} ·{" "}
                      {a.data?.title ||
                        items.find((i) => i.id === a.item_id)?.title ||
                        a.item_id}
                    </Text>
                    {a.data && (
                      <>
                        <Text style={s.body}>{a.data.notes}</Text>
                        <Text style={s.small}>
                          {a.data.kind} · {a.data.status} · {a.data.priority}{" "}
                          priority{"\n"}
                          {dateLabel(a.data.due_at)}
                          {a.data.end_at && " → " + dateLabel(a.data.end_at)}
                          {"\n"}Remind {a.data.reminder_minutes} min before
                        </Text>
                      </>
                    )}
                  </View>
                ))}
                {proposal.actions.length > 0 && (
                  <>
                    <Button
                      title={`Approve ${proposal.actions.length} changes`}
                      disabled={busy}
                      onPress={() =>
                        act(async () => {
                          await api(
                            `/ai/proposals/${proposal.id}/apply`,
                            token,
                            "POST",
                          );
                          setProposal({
                            ...proposal,
                            summary: "Your changes are saved.",
                            actions: [],
                          });
                          await refresh();
                        })
                      }
                    />
                    <Button
                      secondary
                      title="Discard"
                      onPress={() => setProposal(null)}
                    />
                  </>
                )}
              </View>
            )}
            <TextInput
              style={[s.input, { minHeight: 85 }]}
              multiline
              placeholder="Ask Orbyn…"
              value={message}
              onChangeText={setMessage}
              maxLength={4000}
            />
            <Button
              title={busy ? "Thinking…" : "Send →"}
              disabled={busy || !message.trim()}
              onPress={() => ask()}
            />
            <Text style={s.small}>
              Your request and up to 100 recent items are shared with the
              configured AI provider.
            </Text>
          </>
        )}
        {tab === "Inbox" && (
          <>
            {notices.map((n) => (
              <Pressable
                key={n.id}
                style={[s.card, !n.read && { backgroundColor: "#edf2e6" }]}
                onPress={() =>
                  act(async () => {
                    await api(`/notifications/${n.id}/read`, token, "POST");
                    await refresh();
                  })
                }
              >
                <Text style={s.itemTitle}>{n.title}</Text>
                <Text style={s.body}>{n.body}</Text>
                <Text style={s.small}>
                  {dateLabel(n.created_at)}
                  {n.read ? " · Read" : " · Tap to mark read"}
                </Text>
              </Pressable>
            ))}
            {!notices.length && (
              <View style={s.empty}>
                <Text style={s.sectionTitle}>You’re all caught up.</Text>
                <Text style={s.subtitle}>
                  Reminders will land here when it’s time.
                </Text>
              </View>
            )}
          </>
        )}
        {tab === "Settings" && (
          <View style={s.card}>
            <Text style={s.sectionTitle}>{user?.name}</Text>
            <Text style={s.subtitle}>{user?.email}</Text>
            <View style={s.preference}>
              <Text style={s.itemTitle}>Email reminders</Text>
              <Switch
                value={user?.email_reminders}
                disabled={busy}
                trackColor={{ true: "#709566" }}
                onValueChange={(value) =>
                  act(async () =>
                    setUser(
                      await api<User>("/me", token, "PUT", {
                        email_reminders: value,
                      }),
                    ),
                  )
                }
              />
            </View>
            <Button
              title="Enable mobile notifications"
              disabled={busy}
              onPress={enablePush}
            />
            <Button
              secondary
              title="Disable mobile notifications"
              disabled={busy}
              onPress={() =>
                act(async () => {
                  const push = await SecureStore.getItemAsync("orbyn-push");
                  if (push)
                    await api("/devices", token, "DELETE", { token: push });
                  await SecureStore.deleteItemAsync("orbyn-push");
                  Alert.alert("Notifications disabled");
                })
              }
            />
            <Text style={s.small}>
              The AI provider is configured on your server. Provider keys never
              live on this device.
            </Text>
            <Button
              secondary
              title="Sign out"
              disabled={busy}
              onPress={logout}
            />
          </View>
        )}
      </ScrollView>
      <View style={s.tabs}>
        {[
          ["Today", "☼"],
          ["Tasks", "✓"],
          ["Calendar", "▦"],
          ["AI", "✧"],
          ["Inbox", "♧"],
          ["Settings", "⚙"],
        ].map(([t, icon]) => (
          <Pressable
            key={t}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === t }}
            onPress={() => {
              setTab(t);
              setSearch("");
            }}
            style={s.tab}
          >
            <Text style={[s.tabIcon, tab === t && s.selected]}>{icon}</Text>
            <Text style={[s.tabText, tab === t && s.selected]}>{t}</Text>
          </Pressable>
        ))}
      </View>
      <Modal
        visible={!!editing}
        animationType="slide"
        onRequestClose={() => {
          setEditing(null);
          setPicker(null);
        }}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: "#f8f9f6" }}>
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
          >
            <ScrollView
              contentContainerStyle={s.content}
              keyboardShouldPersistTaps="handled"
            >
              {editing && (
                <>
                  <Text style={s.title}>
                    {"id" in editing ? "Edit your plan" : "Make a little plan"}
                  </Text>
                  <Text style={s.label}>What’s the plan?</Text>
                  <TextInput
                    style={s.input}
                    value={editing.title}
                    onChangeText={(title) => setEditing({ ...editing, title })}
                    maxLength={200}
                    placeholder="Something worth making time for"
                  />
                  <Text style={s.label}>Type</Text>
                  <View style={s.choices}>
                    {(["task", "event"] as const).map((kind) => (
                      <Button
                        key={kind}
                        secondary={editing.kind !== kind}
                        title={kind}
                        onPress={() => setEditing({ ...editing, kind })}
                      />
                    ))}
                  </View>
                  <Text style={s.label}>Priority</Text>
                  <View style={s.choices}>
                    {(["low", "medium", "high"] as const).map((priority) => (
                      <Button
                        key={priority}
                        secondary={editing.priority !== priority}
                        title={priority}
                        onPress={() => setEditing({ ...editing, priority })}
                      />
                    ))}
                  </View>
                  {(["due_at", "end_at"] as const).map((field) => (
                    <View key={field}>
                      <Text style={s.label}>
                        {field === "due_at" ? "Due / start" : "End (optional)"}
                      </Text>
                      <Button
                        secondary
                        title={dateLabel(editing[field])}
                        onPress={() => setPicker({ field, mode: "date" })}
                      />
                      {editing[field] && (
                        <Button
                          secondary
                          title="Clear time"
                          onPress={() =>
                            setEditing({ ...editing, [field]: null })
                          }
                        />
                      )}
                    </View>
                  ))}
                  {picker && (
                    <DateTimePicker
                      value={new Date(editing[picker.field] || Date.now())}
                      mode={picker.mode}
                      display={Platform.OS === "ios" ? "spinner" : "default"}
                      onChange={(event, date) => {
                        if (event.type === "dismissed") {
                          setPicker(null);
                          return;
                        }
                        if (date) {
                          const current = new Date(
                            editing[picker.field] || Date.now(),
                          );
                          if (picker.mode === "date")
                            current.setFullYear(
                              date.getFullYear(),
                              date.getMonth(),
                              date.getDate(),
                            );
                          else
                            current.setHours(
                              date.getHours(),
                              date.getMinutes(),
                              0,
                              0,
                            );
                          setEditing({
                            ...editing,
                            [picker.field]: current.toISOString(),
                          });
                          if (Platform.OS === "android")
                            setPicker(
                              picker.mode === "date"
                                ? { ...picker, mode: "time" }
                                : null,
                            );
                        }
                      }}
                    />
                  )}
                  {picker && Platform.OS === "ios" && (
                    <Button
                      title={picker.mode === "date" ? "Choose time" : "Done"}
                      onPress={() => {
                        if (!editing[picker.field])
                          setEditing({
                            ...editing,
                            [picker.field]: new Date().toISOString(),
                          });
                        setPicker(
                          picker.mode === "date"
                            ? { ...picker, mode: "time" }
                            : null,
                        );
                      }}
                    />
                  )}
                  <Text style={s.label}>Notes</Text>
                  <TextInput
                    style={[s.input, { minHeight: 90 }]}
                    multiline
                    value={editing.notes}
                    maxLength={10000}
                    onChangeText={(notes) => setEditing({ ...editing, notes })}
                  />
                  <Text style={s.label}>Remind me before (minutes)</Text>
                  <TextInput
                    style={s.input}
                    keyboardType="number-pad"
                    value={String(editing.reminder_minutes)}
                    onChangeText={(value) =>
                      setEditing({
                        ...editing,
                        reminder_minutes: Number(value) || 0,
                      })
                    }
                  />
                  {!!error && <Text style={s.error}>{error}</Text>}
                  <Button
                    title={busy ? "Saving…" : "Save item"}
                    disabled={busy}
                    onPress={() =>
                      act(async () => {
                        const exists = "id" in editing;
                        await api(
                          exists ? `/items/${editing.id}` : "/items",
                          token,
                          exists ? "PUT" : "POST",
                          exists ? itemBody(editing as Item) : editing,
                        );
                        setEditing(null);
                        setPicker(null);
                        await refresh();
                      })
                    }
                  />
                  {"id" in editing && (
                    <Button
                      secondary
                      title="Delete item"
                      disabled={busy}
                      onPress={() =>
                        Alert.alert(
                          "Delete this item?",
                          "This removes it from your planner.",
                          [
                            { text: "Cancel", style: "cancel" },
                            {
                              text: "Delete",
                              style: "destructive",
                              onPress: () =>
                                act(async () => {
                                  await api(
                                    `/items/${editing.id}?version=${editing.version}`,
                                    token,
                                    "DELETE",
                                  );
                                  setEditing(null);
                                  setPicker(null);
                                  await refresh();
                                }),
                            },
                          ],
                        )
                      }
                    />
                  )}
                  <Button
                    secondary
                    title="Cancel"
                    onPress={() => {
                      setEditing(null);
                      setPicker(null);
                    }}
                  />
                </>
              )}
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </View>
  );
}
export default function App() {
  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: "#f7f8f4" }}>
        <Screen />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
const s = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  auth: {
    flexGrow: 1,
    justifyContent: "center",
    padding: 30,
    backgroundColor: "#edf1e5",
  },
  logo: {
    fontSize: 29,
    fontWeight: "800",
    letterSpacing: -1,
    color: "#355d40",
  },
  hero: {
    fontSize: 43,
    fontWeight: "500",
    letterSpacing: -1.6,
    color: "#304935",
    marginVertical: 20,
  },
  eyebrow: {
    fontSize: 9,
    fontWeight: "600",
    letterSpacing: 1.6,
    color: "#8c9a7d",
    marginTop: 25,
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 21,
    color: "#8a9582",
    marginTop: 8,
    marginBottom: 23,
  },
  input: {
    borderWidth: 1,
    borderColor: "#dfe6d7",
    backgroundColor: "#fff",
    padding: 14,
    borderRadius: 8,
    fontSize: 14,
    color: "#355039",
    marginBottom: 16,
  },
  button: {
    paddingVertical: 13,
    paddingHorizontal: 16,
    backgroundColor: "#436e4f",
    borderRadius: 8,
    alignItems: "center",
    marginBottom: 12,
  },
  secondary: {
    backgroundColor: "#f3f6ed",
    borderWidth: 1,
    borderColor: "#dce5d2",
  },
  buttonText: { fontSize: 13, fontWeight: "600", color: "#fff" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: "#e7ecdf",
  },
  add: { color: "#4d714d", fontSize: 32 },
  content: { padding: 24, paddingBottom: 35 },
  title: {
    fontSize: 29,
    fontWeight: "500",
    letterSpacing: -0.8,
    color: "#334a37",
  },
  stats: {
    flexDirection: "row",
    justifyContent: "space-around",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e6ebdf",
    borderRadius: 12,
    padding: 23,
    marginBottom: 27,
  },
  statValue: {
    fontSize: 30,
    fontWeight: "500",
    color: "#486147",
    marginBottom: 6,
  },
  small: { fontSize: 10, color: "#98a18f", lineHeight: 18 },
  sectionTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: "#40553e",
    marginBottom: 15,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    padding: 17,
    borderWidth: 1,
    borderColor: "#e8edde",
    backgroundColor: "#fff",
    borderRadius: 9,
    marginBottom: 10,
  },
  checkbox: { fontSize: 26, color: "#becab4" },
  itemTitle: {
    fontSize: 13,
    fontWeight: "500",
    color: "#40533c",
    marginBottom: 5,
  },
  arrow: { fontSize: 20, color: "#9dac90" },
  empty: { alignItems: "center", paddingVertical: 32 },
  emptyIcon: { fontSize: 40, color: "#a9bb93", marginBottom: 20 },
  aiCard: {
    backgroundColor: "#ebf0df",
    borderRadius: 13,
    padding: 23,
    marginTop: 15,
    marginBottom: 23,
    borderWidth: 1,
    borderColor: "#dfe7d1",
  },
  card: {
    backgroundColor: "#fff",
    padding: 22,
    borderRadius: 10,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: "#e4eadb",
  },
  body: { fontSize: 13, lineHeight: 21, color: "#65785a", marginVertical: 10 },
  action: { borderTopWidth: 1, borderTopColor: "#e3e9da", paddingVertical: 15 },
  tabs: {
    flexDirection: "row",
    paddingVertical: 11,
    borderTopWidth: 1,
    borderTopColor: "#e2e8d8",
    backgroundColor: "#fff",
  },
  tab: { flex: 1, alignItems: "center", gap: 5 },
  tabIcon: { fontSize: 23, color: "#a9b39f" },
  tabText: { fontSize: 9, color: "#9da793" },
  selected: { color: "#426b43" },
  error: {
    color: "#a05c43",
    backgroundColor: "#fbeddf",
    padding: 13,
    borderRadius: 7,
    fontSize: 12,
    marginBottom: 15,
  },
  preference: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 23,
  },
  label: { fontSize: 11, color: "#708362", marginBottom: 10, marginTop: 5 },
  choices: { flexDirection: "row", gap: 10, marginBottom: 10 },
});
