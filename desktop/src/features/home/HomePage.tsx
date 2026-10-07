import {
  ArrowRight,
  ArrowUpRight,
  Bell,
  Bot,
  Boxes,
  CalendarCheck,
  CalendarDays,
  CalendarSync,
  Check,
  ChevronRight,
  Clock,
  Download,
  FileText,
  Fingerprint,
  GitBranch,
  Laptop,
  ListTodo,
  Mail,
  MessageSquare,
  Orbit,
  Repeat,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Target,
  Timer,
  Users,
  Webhook,
  type LucideIcon,
} from "lucide-react";
import type { MouseEvent } from "react";
import {
  CHARACTER_PRESETS,
  HOME_AGENT_GUIDE,
  HOME_AGENT_IDLE_NOTE,
} from "@orbyn/core";
import { Character } from "../../components/Character";
import { useReveal } from "../../hooks/useReveal";
import { stagger } from "../../lib/motion";
import { LinkDemo, WeekDemo } from "./HomeDemos";
import { FAQ } from "./faq";
import "./home.css";

/** One line of a capability list: what it is, and what it does for you. */
type Point = { icon: LucideIcon; title: string; body: string };

/** How Orbyn plans a day. Each line is something the planner really does. */
const PLANNING: Point[] = [
  {
    icon: Target,
    title: "Focus hours, kept for focus",
    body: "Set aside the hours you do your best work. Orbyn saves them for the tasks that need them.",
  },
  {
    icon: CalendarDays,
    title: "Planned around your meetings",
    body: "It reads your calendar and the calendars you subscribe to, and leaves busy time alone.",
  },
  {
    icon: GitBranch,
    title: "First things first",
    body: "When one task waits on another, it waits in the plan too — and Orbyn says which one is in the way.",
  },
  {
    icon: Timer,
    title: "Estimates that learn",
    body: "It compares how long you guessed with how long things took, and plans the next week with that in mind.",
  },
  {
    icon: Repeat,
    title: "Room for your habits",
    body: "A walk, a weekly review, practice time: habits find their own space in the days you leave free.",
  },
  {
    icon: Check,
    title: "You have the last word",
    body: "See the whole plan before it lands. Move what you like, keep what you don’t want touched, and roll unfinished work forward.",
  },
];

/** What Orbyn connects to. Only the connections that exist. */
const CONNECTS: Point[] = [
  {
    icon: CalendarSync,
    title: "Your calendars",
    body: "Subscribe to any iCal link, publish your own feed, or see your events in Apple Calendar, Thunderbird or DAVx5 over CalDAV.",
  },
  {
    icon: Mail,
    title: "Email to task",
    body: "Forward an email to your private address and it becomes a task.",
  },
  {
    icon: Bot,
    title: "Your own AI tools",
    body: "Connect Claude Code, Codex, Cursor or another MCP agent with an agent key. It can search and read your tasks, calendar, projects and pages, only in the spaces you choose.",
  },
  {
    icon: MessageSquare,
    title: "Slack and Discord",
    body: "Have your morning digest arrive where you already talk.",
  },
  {
    icon: Webhook,
    title: "Webhooks and API keys",
    body: "Let scripts and other apps create and follow your tasks, with keys you can revoke.",
  },
  {
    icon: Download,
    title: "Import and export",
    body: "Bring your data in, take all of it out, and download any page as PDF, Word or Markdown.",
  },
];

/** Why it is safe to keep your life in it. Only what a person using Orbyn gets. */
const YOURS: Point[] = [
  {
    icon: Users,
    title: "Personal stays personal",
    body: "Teammates see only what you share with a team — and when you’re busy, never what you’re doing.",
  },
  {
    icon: Sparkles,
    title: "You choose what it can do",
    body: "Review proposed changes, choose the work you delegate, and keep private spaces out of AI.",
  },
  {
    icon: Fingerprint,
    title: "Passkeys and two-factor",
    body: "Sign in with a passkey or an authenticator app, and end any session you don’t recognise.",
  },
  {
    icon: ShieldCheck,
    title: "Always know it’s working",
    body: "A live status page shows whether every part of Orbyn is up, right now.",
  },
];

function PointList({ points }: { points: Point[] }) {
  return (
    <ul className="home-points">
      {points.map(({ icon: Icon, title, body }, n) => (
        <li key={title} className="reveal" style={stagger(n)}>
          <span className="home-feature-icon">
            <Icon aria-hidden="true" />
          </span>
          <div>
            <h3>{title}</h3>
            <p>{body}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

type Props = { signedIn: boolean; onNavigate: (path: string) => void };
export function HomePage({ signedIn, onNavigate }: Props) {
  const start = () => onNavigate(signedIn ? "/app" : "/signup");
  const revealRoot = useReveal<HTMLDivElement>();
  const openStatus = (e: MouseEvent) => {
    e.preventDefault();
    onNavigate("/status");
  };
  return (
    <div className="home theme-light" ref={revealRoot}>
      <a className="home-skip" href="#home-main">
        Skip to content
      </a>
      <header className="home-nav">
        <a href="/" className="brand" aria-label="Orbyn home">
          <Orbit />
          orbyn<span>•</span>
        </a>
        <nav aria-label="Homepage">
          <a href="#features">Features</a>
          <a href="#planning">Planning</a>
          <a href="#work">Projects & docs</a>
          <a href="#agents">Agents</a>
          <a href="#together">Teams</a>
          <a href="#yours">Privacy</a>
          <a href="#faq">FAQ</a>
        </nav>
        <div className="home-nav-actions">
          {!signedIn && (
            <button
              className="text-button"
              onClick={() => onNavigate("/login")}
            >
              Sign in
            </button>
          )}
          <button className="primary" onClick={start}>
            {signedIn ? "Open your planner" : "Get started"}
            <ArrowUpRight size={15} />
          </button>
        </div>
      </header>
      <main id="home-main">
        <section className="home-hero">
          <div className="home-hero-copy">
            {/* Keep the first screen specific to the work Orbyn supports. */}
            <span className="home-kicker">
              <span /> TASKS · CALENDAR · PROJECTS · NOTES · AI
            </span>
            <h1>
              Plan your day.
              <br />
              Keep work <em>moving.</em>
            </h1>
            <p>
              Keep tasks, calendar and project notes together. Plan around your
              available time, delegate a task to Background, or queue work for
              Overnight and review it in the morning.
            </p>
            <div className="home-hero-actions">
              <button className="primary" onClick={start}>
                {signedIn ? "Back to your space" : "Create your space"}
                <ArrowRight size={18} />
              </button>
              <a href="#features">
                Take a look around <ChevronRight size={16} />
              </a>
            </div>
            <div className="home-platforms">
              <Laptop size={16} />
              <Smartphone size={16} />
              <span>One planner. Web, desktop, iOS and Android.</span>
            </div>
          </div>
          <div
            className="home-scene"
            role="img"
            aria-label="Example Orbyn planner showing project work and a team check-in"
          >
            <div className="home-preview" aria-hidden="true">
              <div className="home-preview-top">
                <span>
                  <Orbit size={17} /> My space
                </span>
                <small>EXAMPLE DAY</small>
              </div>
              {/* Illustration caption stays outside the heading outline. */}
              <p className="home-preview-title">Today’s plan.</p>
              <div className="home-preview-date">
                <CalendarDays size={14} /> Today’s focus <span>3 plans</span>
              </div>
              {[
                {
                  title: "Review project notes",
                  detail: "Personal · 8:00 AM",
                  done: true,
                },
                {
                  title: "Draft next steps",
                  detail: "Creative time · 10:00 AM",
                  done: false,
                },
                {
                  title: "Team check-in",
                  detail: "Event · 6:30 PM",
                  done: false,
                },
              ].map((i) => (
                <div className="home-preview-item" key={i.title}>
                  <span className={i.done ? "done" : ""}>
                    {i.done && <Check size={12} />}
                  </span>
                  <div>
                    <strong>{i.title}</strong>
                    <small>{i.detail}</small>
                  </div>
                </div>
              ))}
              <div className="home-preview-bottom">
                <span>Tasks and events, together.</span>
                <span>1 of 3 complete</span>
              </div>
            </div>
          </div>
        </section>

        <section
          className="home-principles reveal"
          aria-label="Product principles"
        >
          <span>
            <ListTodo size={18} /> Tasks and calendar in one place
          </span>
          <span>
            <Sparkles size={18} /> Delegated work with results to review
          </span>
          <span>
            <ShieldCheck size={18} /> You decide what AI can change
          </span>
          <span>
            <Fingerprint size={18} /> Personal plans stay personal
          </span>
        </section>

        <section className="home-features" id="agents">
          <div className="home-section-heading reveal">
            <span className="eyebrow">BACKGROUND AND OVERNIGHT</span>
            <h2>Work you can hand over.</h2>
            <p>
              Give Background a task during the day. Put longer work in your
              Overnight queue. Each keeps its own progress and brings the work
              back for you to review.
            </p>
          </div>
          <div className="home-agent-grid">
            {HOME_AGENT_GUIDE.map((agent) => (
              <article key={agent.name}>
                <div className="home-agent-label">
                  <span className="eyebrow">{agent.timing}</span>
                  <h3>{agent.name}</h3>
                </div>
                <div className="home-agent-detail">
                  <p>{agent.brief}</p>
                  <details className="home-agent-how">
                    <summary>How {agent.name} works</summary>
                    <p>{agent.summary}</p>
                    <div className="home-agent-request">
                      <span>Example request</span>
                      <blockquote>“{agent.request}”</blockquote>
                    </div>

                    <ol
                      className="home-agent-steps"
                      aria-label={`${agent.name} workflow`}
                    >
                      {agent.steps.map((step) => (
                        <li key={step.title}>
                          <strong>{step.title}</strong>
                          <p>{step.body}</p>
                        </li>
                      ))}
                    </ol>
                    <dl className="home-agent-workflow">
                      <div>
                        <dt>Where to review</dt>
                        <dd>{agent.result}</dd>
                      </div>
                      <div>
                        <dt>When it pauses</dt>
                        <dd>{agent.pause}</dd>
                      </div>
                    </dl>
                  </details>
                </div>
              </article>
            ))}
          </div>
          <p className="home-companion-note">{HOME_AGENT_IDLE_NOTE}</p>
        </section>

        <section className="home-features" id="features">
          <div className="home-section-heading reveal">
            <span className="eyebrow">TASKS, CALENDAR AND NOTES</span>
            <h2>
              See the day.
              <br />
              Find the work behind it.
            </h2>
            <p>
              Follow a task from its project notes to a time on your calendar.
              Keep the details close when plans change.
            </p>
          </div>
          <div className="home-feature-grid">
            <article className="home-feature large reveal" style={stagger(0)}>
              <span className="home-feature-icon">
                <CalendarDays />
              </span>
              <h3>Tasks and calendar, in one place.</h3>
              <p>
                Tasks with priorities, subtasks and checklists sit beside your
                events, invitees and reminders. Sort them into lists and tags,
                make them repeat, and add anything in plain words — “lunch with
                Anna tomorrow 1pm” lands on your calendar as just that.
              </p>
              <div className="home-mini-week" aria-hidden="true">
                {["M", "T", "W", "T", "F", "S", "S"].map((d, n) => (
                  <div key={n}>
                    <small>{d}</small>
                    <span className={n === 2 ? "selected" : ""}>{12 + n}</span>
                    <i className={n === 2 || n === 4 ? "marked" : ""} />
                  </div>
                ))}
              </div>
            </article>
            <article className="home-feature reveal" style={stagger(1)}>
              <span className="home-feature-icon">
                <Sparkles />
              </span>
              <h3>Ask about your work.</h3>
              <p>
                Ask for a summary of your week, a plan for tomorrow, or a change
                of direction. Review its suggestions, or explicitly delegate a
                task. You control its access and the changes it can make.
              </p>
              <div className="home-mini-chat">
                “What needs my attention this week?”
                <ArrowUpRight size={16} />
              </div>
            </article>
            <article className="home-feature reveal" style={stagger(2)}>
              <span className="home-feature-icon">
                <Bell />
              </span>
              <h3>Reminders you schedule.</h3>
              <p>
                Choose when to be reminded — in the app, by email or on your
                phone — and start each morning with a short digest of the day
                ahead, in your inbox, Slack or Discord.
              </p>
              <div className="home-feature-note">
                <span /> Choose the time and delivery channel.
              </div>
            </article>
            <article className="home-feature reveal" style={stagger(3)}>
              <span className="home-feature-icon">
                <Clock />
              </span>
              <h3>Focus on a task.</h3>
              <p>
                Focus mode keeps one task in front of you. The time you spend is
                counted as you go, so you can see where the week went — and
                where you’d like it to go instead.
              </p>
              <div className="home-feature-note">
                <span /> One task. The rest can wait.
              </div>
            </article>
          </div>
        </section>

        <section className="home-features" id="companions">
          <div className="home-section-heading reveal">
            <span className="eyebrow">MEET YOUR COMPANION</span>
            <h2>Choose a face. Give it a name.</h2>
            <p>
              Start with a familiar face, then choose its look, accessories and
              movement. Keep it animated, still, or tucked away.
            </p>
          </div>
          <ul
            className="home-companion-grid"
            aria-label="Orbyn character presets"
          >
            {CHARACTER_PRESETS.map(({ name, appearance }) => (
              <li key={name}>
                <Character appearance={appearance} name={name} size={96} />
                <span>{name}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="home-features home-split" id="planning">
          <div className="home-section-heading reveal">
            <span className="eyebrow">AUTOMATIC PLANNING</span>
            <h2>
              It plans your day.
              <br />
              You have the last word.
            </h2>
            <p>
              Tell Orbyn how long things take and when you like to work. It
              finds the time between your meetings, in an order that makes
              sense, and shows you the plan before anything moves.
            </p>
            <WeekDemo />
          </div>
          <PointList points={PLANNING} />
        </section>

        <section className="home-features" id="work">
          <div className="home-section-heading reveal">
            <span className="eyebrow">PROJECTS AND PAGES</span>
            <h2>Project tasks and their notes.</h2>
            <p>
              Projects keep the work in order. Pages keep the words beside it.
            </p>
          </div>
          <div className="home-feature-grid">
            <article className="home-feature large reveal" style={stagger(0)}>
              <span className="home-feature-icon">
                <Boxes />
              </span>
              <h3>Projects, from brief to done.</h3>
              <p>
                Move work through stages on a board, see it on a timeline, and
                know which projects are at risk before their deadline. Say
                “break this project into tasks” and Orbyn drafts the subtasks
                with estimates and an order, already fitted into your focus
                hours — you approve it before anything is created.
              </p>
              <div className="home-feature-note">
                <span /> From one sentence to a plan you can start on.
              </div>
            </article>
            <article className="home-feature large reveal" style={stagger(1)}>
              <span className="home-feature-icon">
                <FileText />
              </span>
              <h3>Docs and notes that stay with the work.</h3>
              <p>
                Write briefs and meeting notes with headings, checklists that
                become tasks, code and maths. Edit together live, comment on the
                exact words, suggest changes for someone else to accept, and go
                back to any earlier version. Ask a page a question, or ask it to
                rewrite a line.
              </p>
              <LinkDemo />
              <div className="home-feature-note">
                <span /> Download as PDF, Word, Markdown or HTML.
              </div>
            </article>
          </div>
        </section>

        <section className="home-features" id="together">
          <div className="home-section-heading reveal">
            <span className="eyebrow">TEAMS AND BOOKING</span>
            <h2>Shared plans and booking.</h2>
            <p>Share what should be shared. Keep the rest your own.</p>
          </div>
          <div className="home-feature-grid">
            <article className="home-feature reveal" style={stagger(0)}>
              <span className="home-feature-icon">
                <Users />
              </span>
              <h3>Plans are better together.</h3>
              <p>
                Share tasks, events and pages with a team. Owners, admins,
                members and viewers each know what they can change. See when
                people are free — never what they’re doing — balance the
                workload, and let Orbyn suggest a time to meet.
              </p>
              <div className="home-avatars" aria-hidden="true">
                <span>A</span>
                <span>J</span>
                <span>M</span>
                <small>Shared with your team.</small>
              </div>
            </article>
            <article className="home-feature reveal" style={stagger(1)}>
              <span className="home-feature-icon">
                <CalendarCheck />
              </span>
              <h3>Let people find a time.</h3>
              <p>
                Share a booking page with your own hours, questions and
                reminders. Share one across a team so bookings go round in turn,
                approve the ones you want, and let people reschedule or cancel
                from a link.
              </p>
              <div className="home-feature-note">
                <span /> No back and forth.
              </div>
            </article>
          </div>
        </section>

        <section className="home-features home-split" id="connects">
          <div className="home-section-heading reveal">
            <span className="eyebrow">WORKS WITH WHAT YOU USE</span>
            <h2>
              Connected,
              <br />
              on your terms.
            </h2>
            <p>
              Orbyn talks to your calendars, your inbox and your tools — and
              only sends what you connect.
            </p>
          </div>
          <PointList points={CONNECTS} />
        </section>

        <section className="home-yours" id="yours">
          <div className="home-section-heading reveal">
            <span className="eyebrow">PRIVATE BY DESIGN</span>
            <h2>
              A lot of your life.
              <br />
              <em>Kept that way.</em>
            </h2>
            <p>
              A planner knows where you’ll be and what you’re working on. Orbyn
              shares only what you choose, and changes nothing you haven’t
              approved.
            </p>
          </div>
          <PointList points={YOURS} />
        </section>

        <section className="home-how" id="how-it-works">
          <div className="home-section-heading reveal">
            <span className="eyebrow">GET STARTED</span>
            <h2>Add a task. Choose when to work.</h2>
          </div>
          <div className="home-steps">
            {[
              {
                title: "Capture the work.",
                body: "Capture a task, an event, or something you want to make time for — in plain words, from any device.",
              },
              {
                title: "Plan the time.",
                body: "Give it a date, a priority and a rough size. Let Orbyn find it a time, or ask your assistant for a hand.",
              },
              {
                title: "Review and adjust.",
                body: "Check in from anywhere. Adjust as life changes. Review completed and unfinished work.",
              },
            ].map((step, n) => (
              <article key={step.title} className="reveal" style={stagger(n)}>
                <span>0{n + 1}</span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="home-everywhere" id="everywhere">
          <div className="reveal">
            <span className="eyebrow">SAME SPACE. WHEREVER YOU ARE.</span>
            <h2>
              At your desk.
              <br />
              Out in the world.
              <br />
              <em>Still in your orbit.</em>
            </h2>
            <p>
              Your plans belong together, even when your day takes you somewhere
              else. Web, desktop, iOS and Android connect to the same planner,
              and your phone keeps your plans on hand when the signal drops.
            </p>
            <div className="home-device-chips">
              <span>
                <Laptop size={16} /> Web & desktop
              </span>
              <span>
                <Smartphone size={16} /> iOS & Android
              </span>
            </div>
          </div>
          <div
            className="home-device-art reveal"
            style={stagger(2)}
            aria-hidden="true"
          >
            <div className="home-device-desktop">
              <Orbit size={22} />
              <div className="home-device-line wide" />
              <div className="home-device-line" />
              <div className="home-device-blocks">
                <i />
                <i />
                <i />
              </div>
              <div className="home-device-line wide" />
              <div className="home-device-line wide" />
            </div>
            <div className="home-device-phone">
              <div className="home-phone-notch" />
              <Orbit size={19} />
              <div className="home-device-line wide" />
              <div className="home-device-line" />
              <div className="home-device-blocks">
                <i />
              </div>
              <div className="home-device-line wide" />
              <div className="home-device-line wide" />
            </div>
          </div>
        </section>

        <section className="home-faq" id="faq">
          <div className="home-section-heading reveal">
            <span className="eyebrow">QUESTIONS, ANSWERED</span>
            <h2>Before you start.</h2>
          </div>
          <div className="home-faq-list">
            {FAQ.map(({ q, a }) => (
              <details key={q} className="reveal">
                <summary>
                  <h3>{q}</h3>
                  <ChevronRight size={16} aria-hidden="true" />
                </summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="home-final reveal">
          <Orbit size={37} />
          <span className="eyebrow">TASKS · PLANNING · DELEGATED WORK</span>
          <h2>Start with your next task.</h2>
          <p>Keep your plans, notes and agent results together.</p>
          <button className="primary" onClick={start}>
            {signedIn ? "Open your planner" : "Create your space"}
            <ArrowRight size={17} />
          </button>
        </section>
      </main>
      <footer className="home-footer">
        <a href="/" className="brand">
          <Orbit />
          orbyn<span>•</span>
        </a>
        <span>Tasks, calendar, projects and notes.</span>
        <nav className="home-footer-links" aria-label="Footer">
          <a href="#planning" className="text-button">
            Planning
          </a>
          <a href="#work" className="text-button">
            Projects & docs
          </a>
          <a href="#connects" className="text-button">
            Integrations
          </a>
          <a href="#faq" className="text-button">
            FAQ
          </a>
          <a href="/status" className="text-button" onClick={openStatus}>
            Status
          </a>
          <a
            href="/privacy"
            className="text-button"
            onClick={(e) => {
              e.preventDefault();
              onNavigate("/privacy");
            }}
          >
            Privacy Policy
          </a>
          <a
            href="/security"
            className="text-button"
            onClick={(e) => {
              e.preventDefault();
              onNavigate("/security");
            }}
          >
            Security and data
          </a>
          <a
            href="/terms"
            className="text-button"
            onClick={(e) => {
              e.preventDefault();
              onNavigate("/terms");
            }}
          >
            Terms
          </a>
          <button
            className="text-button"
            onClick={() => onNavigate(signedIn ? "/app" : "/login")}
          >
            {signedIn ? "Open planner" : "Sign in"}
            <ArrowUpRight size={14} />
          </button>
          <a
            href="https://www.codehype.ai/product/orbyn?utm_source=codehype_badge"
            target="_blank"
            rel="noopener noreferrer"
          >
            <img
              src="https://www.codehype.ai/badges/orbyn.svg?variant=find-us&v=20"
              alt="Featured on CodeHype"
              width={180}
              height={65}
              loading="lazy"
              decoding="async"
              style={{
                display: "inline-block",
                border: 0,
                width: "100%",
                maxWidth: 180,
                height: "auto",
                maxHeight: 65,
              }}
            />
          </a>
        </nav>
      </footer>
    </div>
  );
}
