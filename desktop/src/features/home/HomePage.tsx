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
    body: "Reserve your best hours for focused tasks.",
  },
  {
    icon: CalendarDays,
    title: "Planned around your meetings",
    body: "Plans around your calendar and subscribed calendars.",
  },
  {
    icon: GitBranch,
    title: "First things first",
    body: "Dependent tasks wait until their blockers clear.",
  },
  {
    icon: Timer,
    title: "Estimates that learn",
    body: "Past estimates help shape future plans.",
  },
  {
    icon: Repeat,
    title: "Room for your habits",
    body: "Make room for recurring habits.",
  },
  {
    icon: Check,
    title: "You have the last word",
    body: "Review the plan, move tasks and carry unfinished work forward.",
  },
];

/** What Orbyn connects to. Only the connections that exist. */
const CONNECTS: Point[] = [
  {
    icon: CalendarSync,
    title: "Your calendars",
    body: "Subscribe or publish a calendar feed; sync with CalDAV apps.",
  },
  {
    icon: Mail,
    title: "Email to task",
    body: "Forward an email to your private address and it becomes a task.",
  },
  {
    icon: Bot,
    title: "Your own AI tools",
    body: "Connect MCP agents to the spaces you choose.",
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
    body: "Import your data or export pages and your full space.",
  },
];

/** Why it is safe to keep your life in it. Only what a person using Orbyn gets. */
const YOURS: Point[] = [
  {
    icon: Users,
    title: "Personal stays personal",
    body: "Teammates see shared work and availability, not private plans.",
  },
  {
    icon: Sparkles,
    title: "You choose what it can do",
    body: "Review proposed changes, choose the work you delegate, and keep private spaces out of AI.",
  },
  {
    icon: Fingerprint,
    title: "Passkeys and two-factor",
    body: "Use a passkey or authenticator; end sessions you don't recognise.",
  },
  {
    icon: ShieldCheck,
    title: "Always know it’s working",
    body: "Check service health on the status page.",
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
              Plan tasks, calendar and projects together. Delegate work to
              Background or Overnight.
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
            <a
              className="home-launch-badge"
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
              Give Background a task now, or queue it for Overnight. Review the
              result when it's ready.
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
            <p>Keep each task, its notes and its time together.</p>
          </div>
          <div className="home-feature-grid">
            <article className="home-feature large reveal" style={stagger(0)}>
              <span className="home-feature-icon">
                <CalendarDays />
              </span>
              <h3>Tasks and calendar, in one place.</h3>
              <p>
                Add tasks and events in plain words. Organize work with lists,
                tags, checklists and reminders.
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
                Ask for a summary or a plan. Review suggestions before changes;
                delegate a task when you're ready.
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
                Set reminders in the app, by email or on your phone. Choose
                where your morning digest arrives.
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
              <p>Keep one task in view and track the time you spend on it.</p>
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
            <p>Choose a face, look and movement. Show it or tuck it away.</p>
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
              Set your focus hours and estimates. Review the proposed schedule
              before anything moves.
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
                Track stages on a board or timeline. Orbyn can draft subtasks
                and estimates for your approval.
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
                Write and edit together. Comment, suggest changes, restore
                versions and turn checklists into tasks.
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
                Share tasks, events and pages with your team. See availability
                without revealing private plans.
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
                Set your hours and share a booking page. Guests can reschedule
                or cancel from their link.
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
            <p>Choose what to share and what Orbyn can change.</p>
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
              Your plans stay together across web, desktop, iOS and Android.
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
        </nav>
      </footer>
    </div>
  );
}
