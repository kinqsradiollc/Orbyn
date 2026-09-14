import React, { useState, useEffect, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  Orbit,
  Sun,
  CalendarDays,
  ListTodo,
  Sparkles,
  Bell,
  Settings,
  Plus,
  Search,
  ArrowUpRight,
  ArrowRight,
  Check,
  X,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Trash2,
  Clock,
  Menu,
} from "lucide-react";
import {
  api,
  itemBody,
  type Item,
  type User,
  type Notice,
  type Proposal,
} from "./api";
import "./style.css";
const dateLabel = (value: string | null) =>
  value
    ? new Date(value).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "Anytime";
const localDate = (value: string | null) =>
  value
    ? new Date(
        new Date(value).getTime() - new Date(value).getTimezoneOffset() * 60000,
      )
        .toISOString()
        .slice(0, 16)
    : "";
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
function App() {
  const [token, setToken] = useState(
    () => sessionStorage.getItem("orbyn-session") || "",
  );
  const [user, setUser] = useState<User | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [view, setView] = useState("Overview");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Item | "new" | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [message, setMessage] = useState("");
  const [month, setMonth] = useState(new Date());
  const [mobileNav, setMobileNav] = useState(false);
  const [register, setRegister] = useState(true);
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const refreshSeq = useRef(0);
  const clearSession = () => {
    sessionStorage.removeItem("orbyn-session");
    setToken("");
    setUser(null);
    setItems([]);
    setNotices([]);
    setProposal(null);
  };
  const refresh = useCallback(async () => {
    if (!token) return;
    const seq = ++refreshSeq.current;
    setLoading(true);
    try {
      const all: Item[] = [];
      for (let offset = 0; ; offset += 500) {
        const page = await api<Item[]>(
          `/items?limit=500&offset=${offset}`,
          token,
        );
        all.push(...page);
        if (page.length < 500) break;
      }
      const [u, n] = await Promise.all([
        api<User>("/me", token),
        api<Notice[]>("/notifications", token),
      ]);
      if (tokenRef.current !== token || seq !== refreshSeq.current) return;
      setItems(all);
      setUser(u);
      setNotices(n);
    } finally {
      if (tokenRef.current === token) setLoading(false);
    }
  }, [token]);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      try {
        if (document.visibilityState === "visible") await refresh();
      } catch (e) {
        if (alive) {
          setError((e as Error).message);
          if ((e as { status?: number }).status === 401) clearSession();
        }
      }
      if (alive) timer = setTimeout(loop, 30000);
    };
    void loop();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [refresh]);
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
      if ((e as { status?: number }).status === 401) clearSession();
    } finally {
      setBusy(false);
    }
  };
  const navigate = (v: string) => {
    setView(v);
    setMobileNav(false);
    setQuery("");
  };
  const today = new Date();
  const pending = items.filter((i) => i.status !== "done");
  const todayItems = pending.filter(
    (i) => i.due_at && sameDay(new Date(i.due_at), today),
  );
  const overdue = pending.filter(
    (i) =>
      i.due_at &&
      new Date(i.due_at) < today &&
      !sameDay(new Date(i.due_at), today),
  );
  const upcoming = pending
    .filter((i) => i.due_at && new Date(i.due_at) >= today)
    .sort((a, b) => a.due_at!.localeCompare(b.due_at!));
  const done = items.filter((i) => i.status === "done").length;
  const toggle = (i: Item) =>
    act(async () => {
      await api(`/items/${i.id}`, token, "PUT", {
        ...itemBody(i),
        status: i.status === "done" ? "todo" : "done",
      });
      await refresh();
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
  const row = (i: Item) => (
    <div
      className={"item-row " + (i.status === "done" ? "completed" : "")}
      key={i.id}
    >
      <button
        disabled={busy}
        className={"check " + (i.status === "done" ? "checked" : "")}
        aria-label={
          i.status === "done" ? "Reopen " + i.title : "Complete " + i.title
        }
        onClick={() => toggle(i)}
      >
        {i.status === "done" && <Check size={13} />}
      </button>
      <button className="item-main" onClick={() => setEditing(i)}>
        <strong>{i.title}</strong>
        <span>
          {i.kind === "event" ? "Event" : i.notes || "Personal"}
          {i.due_at && " · " + dateLabel(i.due_at)}
        </span>
      </button>
      <span className={"priority " + i.priority}>{i.priority}</span>
      <button
        className="icon-button"
        aria-label={"Edit " + i.title}
        onClick={() => setEditing(i)}
      >
        <ArrowUpRight size={17} />
      </button>
    </div>
  );
  if (!token)
    return (
      <div className="auth-page">
        <div className="auth-story">
          <div className="brand">
            <Orbit /> orbyn<span>•</span>
          </div>
          <div>
            <span className="eyebrow">
              A LITTLE CLARITY. A LOT MORE POSSIBILITY.
            </span>
            <h1>
              Your life.
              <br />
              In a better orbit.
            </h1>
            <p>
              Bring your tasks, plans, and big ideas together.
              <br />
              Make space for what matters.
            </p>
            <div className="orbit-art">
              <div />
              <div />
              <div />
              <span>✦</span>
            </div>
          </div>
          <small>Thoughtfully planned. Entirely yours.</small>
        </div>
        <main className="auth-form">
          <div className="auth-card">
            <span className="eyebrow">WELCOME TO YOUR SPACE</span>
            <h2>
              {register ? "A fresh start awaits." : "Good to have you back."}
            </h2>
            <p>
              {register
                ? "Create your account and find your flow."
                : "Sign in to pick up where you left off."}
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const d = new FormData(e.currentTarget);
                void act(async () => {
                  const result = await api<{ token: string; user: User }>(
                    `/auth/${register ? "register" : "login"}`,
                    "",
                    "POST",
                    Object.fromEntries(d),
                  );
                  sessionStorage.setItem("orbyn-session", result.token);
                  setToken(result.token);
                  setUser(result.user);
                });
              }}
            >
              {register && (
                <label>
                  Your name
                  <input
                    name="name"
                    required
                    maxLength={80}
                    autoComplete="name"
                    placeholder="Alex Morgan"
                  />
                </label>
              )}
              <label>
                Email address
                <input
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                />
              </label>
              <label>
                Password
                <input
                  name="password"
                  type="password"
                  minLength={10}
                  maxLength={128}
                  required
                  autoComplete={register ? "new-password" : "current-password"}
                  placeholder="At least 10 characters"
                />
              </label>
              {error && (
                <div role="alert" className="error">
                  {error}
                </div>
              )}
              <button className="primary wide" disabled={busy}>
                {busy
                  ? "One moment…"
                  : register
                    ? "Create your space"
                    : "Sign in"}
                <ArrowRight size={17} />
              </button>
            </form>
            <button
              className="text-button"
              onClick={() => {
                setRegister(!register);
                setError("");
              }}
            >
              {register
                ? "Already have an account? Sign in"
                : "New here? Create an account"}
            </button>
          </div>
        </main>
      </div>
    );
  return (
    <div className="app">
      <aside className={"sidebar " + (mobileNav ? "open" : "")}>
        <div className="brand">
          <Orbit /> orbyn<span>•</span>
        </div>
        <div className="workspace">
          <span className="avatar">{user?.name[0] || "O"}</span>
          <div>
            <strong>Personal space</strong>
            <small>Room for everything</small>
          </div>
        </div>
        <span className="nav-label">YOUR WORKSPACE</span>
        <nav>
          {[
            ["Overview", Sun],
            ["My tasks", ListTodo],
            ["Calendar", CalendarDays],
            ["AI assistant", Sparkles],
            ["Notifications", Bell],
          ].map(([label, Icon]) => (
            <button
              key={String(label)}
              className={view === label ? "active" : ""}
              onClick={() => navigate(String(label))}
            >
              {React.createElement(Icon, { size: 18 })}
              <span>{String(label)}</span>
              {label === "Notifications" && notices.some((n) => !n.read) && (
                <i />
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <Sparkles size={18} />
            <strong>A little help, a clearer day.</strong>
            <p>Let Orbyn connect the dots in your plans.</p>
            <button onClick={() => navigate("AI assistant")}>
              Meet your assistant <ArrowUpRight size={14} />
            </button>
          </div>
          <button
            className="settings-link"
            onClick={() => navigate("Settings")}
          >
            <Settings size={17} /> Settings
          </button>
          <div className="profile">
            <span className="avatar">{user?.name[0] || "O"}</span>
            <div>
              <strong>{user?.name || "Loading…"}</strong>
              <small>Personal account</small>
            </div>
            <button
              className="icon-button"
              aria-label="Sign out"
              onClick={() =>
                act(async () => {
                  await api("/auth/logout", token, "POST");
                  sessionStorage.removeItem("orbyn-session");
                  setToken("");
                  setUser(null);
                  setItems([]);
                  setNotices([]);
                  setProposal(null);
                })
              }
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      <div className="shell">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="Toggle navigation"
            onClick={() => setMobileNav(!mobileNav)}
          >
            <Menu size={20} />
          </button>
          <span>
            My workspace <span className="slash">/</span>{" "}
            <strong>{view}</strong>
          </span>
          <div>
            <span className="today-label">
              {today.toLocaleDateString([], {
                weekday: "short",
                month: "short",
                day: "numeric",
              })}
            </span>
            <button
              className="icon-button"
              aria-label="Notifications"
              onClick={() => navigate("Notifications")}
            >
              <Bell size={18} />
            </button>
          </div>
        </header>
        <main className="content">
          {error && (
            <div role="alert" className="error">
              {error}
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                {view === "Overview"
                  ? "A FRESH PERSPECTIVE"
                  : "YOUR PERSONAL ORBIT"}
              </span>
              <h1>
                {view === "Overview"
                  ? `Hello, ${user?.name.split(" ")[0] || "there"}.`
                  : view === "My tasks"
                    ? "Small steps. Big things."
                    : view === "AI assistant"
                      ? "A little help thinking ahead."
                      : view}
              </h1>
              <p>
                {view === "Overview"
                  ? "Let's make room for a good day."
                  : view === "My tasks"
                    ? "Everything on your mind, with a place to land."
                    : view === "Calendar"
                      ? "A little perspective on the days ahead."
                      : view === "AI assistant"
                        ? "Summarize your plans, untangle your week, or make a fresh start."
                        : "Your space, just the way you like it."}
              </p>
            </div>
            {!["Settings", "AI assistant", "Notifications"].includes(view) && (
              <button className="primary" onClick={() => setEditing("new")}>
                <Plus size={17} /> New item
              </button>
            )}
          </div>
          {view === "Overview" && (
            <>
              <section className="stats">
                <div>
                  <span>
                    <Sun size={17} /> On your radar today
                  </span>
                  <strong>
                    {todayItems.length}
                    <small>planned for today</small>
                  </strong>
                </div>
                <div>
                  <span>
                    <ListTodo size={17} /> A little progress
                  </span>
                  <strong>
                    {done}
                    <small>items completed</small>
                  </strong>
                </div>
                <div>
                  <span>
                    <Clock size={17} /> Needs a moment
                  </span>
                  <strong>
                    {overdue.length}
                    <small>overdue items</small>
                  </strong>
                </div>
              </section>
              <div className="overview-grid">
                <div>
                  <section className="card focus-card">
                    <div className="section-heading">
                      <h2>
                        Today’s focus <span>{todayItems.length}</span>
                      </h2>
                      <button
                        className="text-button"
                        onClick={() => navigate("My tasks")}
                      >
                        All tasks <ArrowRight size={14} />
                      </button>
                    </div>
                    {todayItems.length ? (
                      todayItems.map(row)
                    ) : (
                      <div className="empty">
                        <Sun size={30} />
                        <h3>A little breathing room.</h3>
                        <p>
                          Your day is open. Add something worth making time for.
                        </p>
                        <button
                          className="text-button"
                          onClick={() => setEditing("new")}
                        >
                          Plan your first item <Plus size={14} />
                        </button>
                      </div>
                    )}
                  </section>
                  <section className="card">
                    <div className="section-heading">
                      <h2>Coming into view</h2>
                      <CalendarDays size={18} />
                    </div>
                    {upcoming.slice(0, 4).map((i) => (
                      <button
                        className="upcoming"
                        key={i.id}
                        onClick={() => setEditing(i)}
                      >
                        <span className="date-tile">
                          <small>
                            {new Date(i.due_at!).toLocaleDateString([], {
                              month: "short",
                            })}
                          </small>
                          {new Date(i.due_at!).getDate()}
                        </span>
                        <span>
                          <strong>{i.title}</strong>
                          <small>
                            {dateLabel(i.due_at)} · {i.kind}
                          </small>
                        </span>
                        <ArrowUpRight size={17} />
                      </button>
                    ))}
                    {!upcoming.length && (
                      <p className="muted pad">
                        No upcoming plans yet. Your next idea can start here.
                      </p>
                    )}
                  </section>
                </div>
                <div>
                  <section className="assistant-card">
                    <span className="sparkle-box">
                      <Sparkles size={23} />
                    </span>
                    <span className="eyebrow">A MIND BESIDE YOURS</span>
                    <h2>
                      Find your next
                      <br />
                      clear step.
                    </h2>
                    <p>
                      Let’s turn a busy mind into a plan that feels possible.
                    </p>
                    <button
                      onClick={() => {
                        navigate("AI assistant");
                        void ask(
                          "Summarize my upcoming plans and suggest what I should focus on.",
                        );
                      }}
                    >
                      Help me plan my day <ArrowUpRight size={17} />
                    </button>
                    <div className="abstract-orbit">
                      <i />
                      <i />
                      <span>✦</span>
                    </div>
                  </section>
                  <section className="card progress-card">
                    <h2>Your momentum</h2>
                    <div className="progress-line">
                      <strong>
                        {items.length
                          ? Math.round((done / items.length) * 100)
                          : 0}
                        %
                      </strong>
                      <span>of your plans complete</span>
                    </div>
                    <div className="progress-track">
                      <div
                        style={{
                          width: `${items.length ? (done / items.length) * 100 : 0}%`,
                        }}
                      />
                    </div>
                    <p>Progress happens one small step at a time.</p>
                  </section>
                </div>
              </div>
            </>
          )}
          {view === "My tasks" && (
            <section className="card">
              <div className="section-heading">
                <h2>
                  All items <span>{items.length}</span>
                </h2>
                <div className="search">
                  <Search size={16} />
                  <input
                    aria-label="Search items"
                    placeholder="Find something…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
              </div>
              {items
                .filter((i) =>
                  (i.title + " " + i.notes)
                    .toLowerCase()
                    .includes(query.toLowerCase()),
                )
                .map(row)}
              {!items.length && (
                <div className="empty">
                  <ListTodo size={30} />
                  <h3>Give your ideas a home.</h3>
                  <p>Add a task or event to start building your plan.</p>
                </div>
              )}
            </section>
          )}
          {view === "Calendar" && (
            <section className="card calendar">
              <div className="section-heading">
                <h2>
                  {month.toLocaleDateString([], {
                    month: "long",
                    year: "numeric",
                  })}
                </h2>
                <div>
                  <button
                    className="icon-button"
                    aria-label="Previous month"
                    onClick={() =>
                      setMonth(
                        new Date(month.getFullYear(), month.getMonth() - 1, 1),
                      )
                    }
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <button
                    className="text-button"
                    onClick={() => setMonth(new Date())}
                  >
                    Today
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Next month"
                    onClick={() =>
                      setMonth(
                        new Date(month.getFullYear(), month.getMonth() + 1, 1),
                      )
                    }
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
              </div>
              <div className="calendar-grid">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                  <div className="day-name" key={d}>
                    {d}
                  </div>
                ))}
                {Array.from({ length: 42 }, (_, n) => {
                  const d = new Date(
                    month.getFullYear(),
                    month.getMonth(),
                    n -
                      new Date(
                        month.getFullYear(),
                        month.getMonth(),
                        1,
                      ).getDay() +
                      1,
                  );
                  return (
                    <div
                      key={n}
                      className={
                        "calendar-day " +
                        (d.getMonth() !== month.getMonth() ? "outside " : "") +
                        (sameDay(d, today) ? "is-today" : "")
                      }
                    >
                      <span>{d.getDate()}</span>
                      {items
                        .filter(
                          (i) => i.due_at && sameDay(new Date(i.due_at), d),
                        )
                        .map((i) => (
                          <button
                            key={i.id}
                            className={i.status === "done" ? "done" : ""}
                            onClick={() => setEditing(i)}
                          >
                            {i.title}
                          </button>
                        ))}
                    </div>
                  );
                })}
              </div>
            </section>
          )}
          {view === "AI assistant" && (
            <section className="card chat">
              <div className="assistant-intro">
                <Sparkles size={30} />
                <h2>What’s on your mind?</h2>
                <p>
                  Ask for a summary, create a plan, or adjust your existing
                  items.
                  <br />
                  You’ll review all changes before they’re saved.
                </p>
                <div className="suggestions">
                  {[
                    "Summarize my week",
                    "What needs my attention?",
                    "Help me plan tomorrow",
                  ].map((s) => (
                    <button key={s} disabled={busy} onClick={() => ask(s)}>
                      {s}
                      <ArrowUpRight size={14} />
                    </button>
                  ))}
                </div>
              </div>
              {proposal && (
                <div className="proposal">
                  <p>{proposal.summary}</p>
                  {proposal.actions.map((a, n) => (
                    <div className="proposal-action" key={n}>
                      <strong>
                        {a.operation.toUpperCase()} ·{" "}
                        {a.data?.title ||
                          items.find((i) => i.id === a.item_id)?.title ||
                          a.item_id}
                      </strong>
                      {a.data && (
                        <>
                          <p>{a.data.notes}</p>
                          <small>
                            {a.data.kind} · {a.data.status} · {a.data.priority}{" "}
                            priority
                            <br />
                            {dateLabel(a.data.due_at)}
                            {a.data.end_at &&
                              " → " + dateLabel(a.data.end_at)}{" "}
                            · Remind {a.data.reminder_minutes} min before
                          </small>
                        </>
                      )}
                    </div>
                  ))}
                  {proposal.actions.length > 0 && (
                    <div className="button-row">
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() =>
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
                      >
                        Approve {proposal.actions.length} changes
                      </button>
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => setProposal(null)}
                      >
                        Discard
                      </button>
                    </div>
                  )}
                </div>
              )}
              <form
                className="chat-input"
                onSubmit={(e) => {
                  e.preventDefault();
                  void ask();
                }}
              >
                <input
                  aria-label="Message your assistant"
                  placeholder="Make a little space. Ask Orbyn…"
                  value={message}
                  maxLength={4000}
                  onChange={(e) => setMessage(e.target.value)}
                />
                <button className="primary" disabled={busy || !message.trim()}>
                  {busy ? "Thinking…" : "Send"}
                  <ArrowRight size={16} />
                </button>
              </form>
              <small className="muted">
                Your request and up to 100 recent items are shared with your
                configured AI provider.
              </small>
            </section>
          )}
          {view === "Notifications" && (
            <section className="card">
              {notices.map((n) => (
                <button
                  className={"notice " + (n.read ? "read" : "")}
                  key={n.id}
                  onClick={() =>
                    act(async () => {
                      await api(`/notifications/${n.id}/read`, token, "POST");
                      await refresh();
                    })
                  }
                >
                  <Bell size={19} />
                  <span>
                    <strong>{n.title}</strong>
                    <p>{n.body}</p>
                    <small>
                      {dateLabel(n.created_at)}
                      {n.read ? " · Read" : ""}
                    </small>
                  </span>
                  {!n.read && <i />}
                </button>
              ))}
              {!notices.length && (
                <div className="empty">
                  <Bell size={30} />
                  <h3>You’re all caught up.</h3>
                  <p>Deadline reminders will appear here.</p>
                </div>
              )}
            </section>
          )}
          {view === "Settings" && (
            <section className="card settings-card">
              <h2>Your account</h2>
              <p>
                {user?.name} · {user?.email}
              </p>
              <hr />
              <h2>Stay in the loop</h2>
              <label className="preference">
                <span>
                  <strong>Email reminders</strong>
                  <small>
                    Receive a reminder before your tasks and events are due.
                  </small>
                </span>
                <input
                  type="checkbox"
                  checked={user?.email_reminders || false}
                  disabled={busy}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    void act(async () => {
                      setUser(
                        await api<User>("/me", token, "PUT", {
                          email_reminders: checked,
                        }),
                      );
                    });
                  }}
                />
              </label>
              <p className="muted">
                Mobile push notifications can be enabled in the Orbyn mobile
                app. Each item has its own reminder timing.
              </p>
              <hr />
              <h2>AI provider</h2>
              <p className="muted">
                Your server administrator configures the provider URL, API key,
                and model. Keys stay on the backend.
              </p>
            </section>
          )}
          {loading && (
            <small className="sync-status">Syncing your space…</small>
          )}
          <footer>
            A little more clarity. A little more you. <Orbit size={14} />
          </footer>
        </main>
      </div>
      {editing && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-title"
          >
            <div className="section-heading">
              <h2 id="edit-title">
                {editing === "new" ? "Make a little plan" : "Edit your plan"}
              </h2>
              <button
                className="icon-button"
                aria-label="Close editor"
                onClick={() => setEditing(null)}
              >
                <X size={20} />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const d = new FormData(e.currentTarget);
                const data = {
                  title: d.get("title"),
                  notes: d.get("notes"),
                  kind: d.get("kind"),
                  priority: d.get("priority"),
                  status: editing === "new" ? "todo" : editing.status,
                  due_at: d.get("due_at")
                    ? new Date(String(d.get("due_at"))).toISOString()
                    : null,
                  end_at: d.get("end_at")
                    ? new Date(String(d.get("end_at"))).toISOString()
                    : null,
                  reminder_minutes: Number(d.get("reminder_minutes")),
                };
                void act(async () => {
                  await api(
                    editing === "new" ? "/items" : `/items/${editing.id}`,
                    token,
                    editing === "new" ? "POST" : "PUT",
                    editing === "new"
                      ? data
                      : { ...data, version: editing.version },
                  );
                  setEditing(null);
                  await refresh();
                });
              }}
            >
              <label>
                What’s the plan?
                <input
                  autoFocus
                  required
                  name="title"
                  maxLength={200}
                  defaultValue={editing === "new" ? "" : editing.title}
                  placeholder="Something worth making time for"
                />
              </label>
              <div className="form-grid">
                <label>
                  Type
                  <select
                    name="kind"
                    defaultValue={editing === "new" ? "task" : editing.kind}
                  >
                    <option value="task">Task</option>
                    <option value="event">Event</option>
                  </select>
                </label>
                <label>
                  Priority
                  <select
                    name="priority"
                    defaultValue={
                      editing === "new" ? "medium" : editing.priority
                    }
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </label>
                <label>
                  Due / start time
                  <input
                    name="due_at"
                    type="datetime-local"
                    defaultValue={
                      editing === "new" ? "" : localDate(editing.due_at)
                    }
                  />
                </label>
                <label>
                  End time (optional)
                  <input
                    name="end_at"
                    type="datetime-local"
                    defaultValue={
                      editing === "new" ? "" : localDate(editing.end_at)
                    }
                  />
                </label>
              </div>
              <label>
                Notes
                <textarea
                  name="notes"
                  rows={3}
                  maxLength={10000}
                  defaultValue={editing === "new" ? "" : editing.notes}
                  placeholder="A few details, a big idea…"
                />
              </label>
              <label>
                Remind me before (minutes)
                <input
                  name="reminder_minutes"
                  type="number"
                  min={0}
                  max={10080}
                  defaultValue={
                    editing === "new" ? 30 : editing.reminder_minutes
                  }
                />
              </label>
              {error && (
                <div className="error" role="alert">
                  {error}
                </div>
              )}
              <div className="button-row">
                {editing !== "new" && (
                  <button
                    type="button"
                    className="danger"
                    disabled={busy}
                    onClick={() => {
                      if (confirm("Delete this item?"))
                        void act(async () => {
                          await api(
                            `/items/${editing.id}?version=${editing.version}`,
                            token,
                            "DELETE",
                          );
                          setEditing(null);
                          await refresh();
                        });
                    }}
                  >
                    <Trash2 size={16} /> Delete
                  </button>
                )}
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setEditing(null)}
                >
                  Cancel
                </button>
                <button className="primary" disabled={busy}>
                  {busy ? "Saving…" : "Save item"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
