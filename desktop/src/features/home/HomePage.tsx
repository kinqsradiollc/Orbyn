import {
  ArrowRight,
  ArrowUpRight,
  Bell,
  CalendarDays,
  Check,
  ChevronRight,
  Laptop,
  ListTodo,
  Orbit,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Users,
} from "lucide-react";
import type { MouseEvent } from "react";
import { useReveal } from "../../hooks/useReveal";
import { stagger } from "../../lib/motion";
import "./home.css";

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
          <a href="#features">Why Orbyn</a>
          <a href="#how-it-works">How it works</a>
          <a href="#everywhere">Your space, everywhere</a>
          <a href="/status" onClick={openStatus}>
            Status
          </a>
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
            <span className="home-kicker">
              <span /> A LITTLE CLARITY GOES A LONG WAY
            </span>
            <h1>
              Your life.
              <br />
              In a better <em>orbit.</em>
            </h1>
            <p>
              The things you need to do. The people you make time for. The ideas
              you don’t want to lose. Finally, one place for all of it.
            </p>
            <div className="home-hero-actions">
              <button className="primary" onClick={start}>
                {signedIn ? "Back to your space" : "Create your space"}
                <ArrowRight size={18} />
              </button>
              <a href="#how-it-works">
                Take a look around <ChevronRight size={16} />
              </a>
            </div>
            <div className="home-platforms">
              <Laptop size={16} />
              <Smartphone size={16} />
              <span>One planner. Web, desktop, and mobile.</span>
            </div>
          </div>
          <div
            className="home-scene"
            aria-label="Illustrative preview of an Orbyn planner"
          >
            <div className="home-orbit one" />
            <div className="home-orbit two" />
            <div className="home-orbit three" />
            <span className="home-star">✦</span>
            <div className="home-preview">
              <div className="home-preview-top">
                <span>
                  <Orbit size={17} /> My space
                </span>
                <small>EXAMPLE DAY</small>
              </div>
              <h2>A little room for a good day.</h2>
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
            <div className="home-floating-ai">
              <span>
                <Sparkles size={19} />
              </span>
              <div>
                <strong>A mind beside yours.</strong>
                <small>A clear plan starts with a conversation.</small>
              </div>
            </div>
            <div className="home-floating-reminder">
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
              <h3>Make time for what matters.</h3>
              <p>
                Keep tasks, deadlines, and events in one calendar. Set
                priorities, add the details, and see what’s coming into view.
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
              <h3>Think it through, together.</h3>
              <p>
                Ask your assistant for a summary, a new plan, or a change of
                direction. Review its suggestions before anything is saved.
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
                Choose when to be reminded. In-app, email, and mobile
                notifications help you keep your plans in sight.
              </p>
              <div className="home-feature-note">
                <span /> At the right time. In your own rhythm.
              </div>
            </article>
            <article className="home-feature reveal" style={stagger(3)}>
              <span className="home-feature-icon">
                <Users />
              </span>
              <h3>Leave room for your people.</h3>
              <p>
                Share plans with a team. Clear roles let everyone know what they
                can see and change, while personal plans stay personal.
              </p>
              <div className="home-avatars" aria-hidden="true">
                <span>A</span>
                <span>J</span>
                <span>M</span>
                <small>A shared orbit.</small>
              </div>
            </article>
          </div>
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
                body: "Capture a task, an event, or something you want to make time for.",
              },
              {
                title: "Find your rhythm.",
                body: "Give it a date, a priority, and a reminder. Ask your assistant when you need a hand.",
              },
              {
                title: "Keep moving, gently.",
                body: "Check in from any device. Adjust as life changes. Celebrate the things you finish.",
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
              else. Web, desktop, iOS, and Android connect to the same planner.
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
        <div className="home-footer-links">
          <a href="/status" className="text-button" onClick={openStatus}>
            Status
          </a>
          <button
            className="text-button"
            onClick={() => onNavigate(signedIn ? "/app" : "/login")}
          >
            {signedIn ? "Open planner" : "Sign in"}
            <ArrowUpRight size={14} />
          </button>
        </div>
      </footer>
    </div>
  );
}
