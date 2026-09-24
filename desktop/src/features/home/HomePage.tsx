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
import { useReveal } from "../../hooks/useReveal";
import { stagger } from "../../lib/motion";
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
    title: "Nothing changes without you",
    body: "The assistant only suggests. Every change it proposes waits for you to approve it.",
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
            {/* Says plainly what Orbyn is. The headline is a feeling; this
                line is what someone searching for a planner is looking for. */}
            <span className="home-kicker">
              <span /> TASKS · CALENDAR · PROJECTS · NOTES · AI
            </span>
            <h1>
              Your life.
              <br />
              In a better <em>orbit.</em>
            </h1>
            <p>
              One planner for the things you need to do, the people you make
              time for and the ideas you don’t want to lose — that plans your
              day around them.
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
            aria-label="An example day in Orbyn: a quiet morning, time for a big idea, and dinner with friends"
          >
            <div className="home-orbit one" />
            <div className="home-orbit two" />
            <div className="home-orbit three" />
            <span className="home-star">✦</span>
            <div className="home-preview" aria-hidden="true">
              <div className="home-preview-top">
                <span>
                  <Orbit size={17} /> My space
                </span>
                <small>EXAMPLE DAY</small>
              </div>
              {/* An illustration's caption, not a heading of this page: a
                  heading here put "A little room for a good day" into the
                  outline search engines read, between the headline and the
                  page's real sections. */}
              <p className="home-preview-title">
                A little room for a good day.
              </p>
              <div className="home-preview-date">
                <CalendarDays size={14} /> Today’s focus <span>3 plans</span>
              </div>
              {[
                {
                  title: "A quiet start to the morning",
                  detail: "Personal · 8:00 AM",
                  done: true,
                },
                {
                  title: "Give that big idea a little time",
                  detail: "Creative time · 10:00 AM",
                  done: false,
                },
                {
                  title: "Dinner with people who matter",
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
                <span>Little by little, it adds up.</span>
                <span>1 of 3 complete</span>
              </div>
            </div>
            <div className="home-floating-ai" aria-hidden="true">
              <span>
                <Sparkles size={19} />
              </span>
              <div>
                <strong>A mind beside yours.</strong>
                <small>A clear plan starts with a conversation.</small>
              </div>
            </div>
            <div className="home-floating-reminder" aria-hidden="true">
              <Bell size={17} />
              <span>A gentle nudge, right on time.</span>
            </div>
          </div>
        </section>

        <section
          className="home-principles reveal"
          aria-label="Product principles"
        >
          <span>
            <ListTodo size={18} /> Less to hold in your head
          </span>
          <span>
            <Sparkles size={18} /> A little help thinking ahead
          </span>
          <span>
            <ShieldCheck size={18} /> Every AI change is yours to approve
          </span>
          <span>
            <Fingerprint size={18} /> Personal plans stay personal
          </span>
        </section>

        <section className="home-features" id="features">
          <div className="home-section-heading reveal">
            <span className="eyebrow">LIFE HAS A LOT OF MOVING PARTS</span>
            <h2>
              Give them a place
              <br />
              to come together.
            </h2>
            <p>
              A planner for the whole picture, from everyday errands to your
              next big thing.
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
              <h3>An assistant that asks first.</h3>
              <p>
                Ask for a summary of your week, a plan for tomorrow, or a change
                of direction. It reads your tasks and your pages, and every
                change it suggests waits for your approval.
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
              <h3>A nudge before the rush.</h3>
              <p>
                Choose when to be reminded — in the app, by email or on your
                phone — and start each morning with a short digest of the day
                ahead, in your inbox, Slack or Discord.
              </p>
              <div className="home-feature-note">
                <span /> At the right time. In your own rhythm.
              </div>
            </article>
            <article className="home-feature reveal" style={stagger(3)}>
              <span className="home-feature-icon">
                <Clock />
              </span>
              <h3>Stay with one thing.</h3>
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
          </div>
          <PointList points={PLANNING} />
        </section>

        <section className="home-features" id="work">
          <div className="home-section-heading reveal">
            <span className="eyebrow">PROJECTS AND PAGES</span>
            <h2>
              The big things,
              <br />
              and the thinking behind them.
            </h2>
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
                become tasks, code and maths. Comment on the exact words,
                suggest changes for someone else to accept, and go back to any
                earlier version. Ask a page a question, or ask it to rewrite a
                line.
              </p>
              <div className="home-feature-note">
                <span /> Download as PDF, Word, Markdown or HTML.
              </div>
            </article>
          </div>
        </section>

        <section className="home-features" id="together">
          <div className="home-section-heading reveal">
            <span className="eyebrow">TEAMS AND BOOKING</span>
            <h2>
              Leave room
              <br />
              for your people.
            </h2>
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
                <small>A shared orbit.</small>
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
            <span className="eyebrow">A SMALL START IS STILL A START</span>
            <h2>
              From on your mind
              <br />
              to in your plans.
            </h2>
          </div>
          <div className="home-steps">
            {[
              {
                title: "Let it land.",
                body: "Capture a task, an event, or something you want to make time for — in plain words, from any device.",
              },
              {
                title: "Find your rhythm.",
                body: "Give it a date, a priority and a rough size. Let Orbyn find it a time, or ask your assistant for a hand.",
              },
              {
                title: "Keep moving, gently.",
                body: "Check in from anywhere. Adjust as life changes. Celebrate the things you finish.",
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
          <span className="eyebrow">
            A LITTLE MORE CLARITY. A LITTLE MORE YOU.
          </span>
          <h2>Make space for a good day.</h2>
          <p>Your next chapter can start with one small plan.</p>
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
        <span>Thoughtfully planned. Entirely yours.</span>
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
