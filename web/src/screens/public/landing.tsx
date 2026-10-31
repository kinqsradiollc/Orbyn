import { ArrowRight } from "lucide-react";
import { useAccount } from "../../app/account";
import { useTitle } from "../../lib/router";
import { FAQ } from "./faq";
import { go, PublicFrame } from "./PublicFrame";
import { WeekIllustration } from "./WeekIllustration";

const FEATURES = [
  [
    "See your week as a place",
    "Days across, hours along, and priority as height. Overbooked days and clashes show up on their own, and you fix them by moving things.",
  ],
  [
    "It plans. You have the last word",
    "Set your focus hours and estimates. Review the proposed schedule before anything changes.",
  ],
  [
    "Hand work over",
    "Give Background a task now, or queue it for Overnight. Review the result when it's ready.",
  ],
  [
    "Notes that stay with the work",
    "Write and edit together. Keep each task, its notes and its time in one place.",
  ],
  [
    "Plans are better together",
    "Share tasks, events and pages with your team, and share a booking page so people can find a time.",
  ],
  [
    "You decide what AI can change",
    "Every change the assistant proposes waits for your review. Personal plans stay personal.",
  ],
];

export default function Landing() {
  useTitle("");
  const { token } = useAccount();
  const start = token ? "/app" : "/signup";
  return (
    <PublicFrame
      nav={
        <>
          <a href="#features">Features</a>
          <a href="#questions">Questions</a>
        </>
      }
    >
      <main>
        <section className="hero">
          <div className="hero-copy">
            <h1>
              Plan your day.
              <br />
              Keep work moving.
            </h1>
            <p>
              Plan tasks, calendar and projects together. Delegate work to
              Background or Overnight.
            </p>
            <a
              className="btn btn-primary hero-cta"
              href={start}
              onClick={go(start)}
            >
              {token ? "Back to your space" : "Create your space"}
              <ArrowRight aria-hidden="true" />
            </a>
            <p className="small muted">
              One planner. Web, desktop, iOS and Android.
            </p>
          </div>
          <div
            className="hero-art"
            role="img"
            aria-label="Example week in Orbyn's 3D planner, with events, work sessions and one overbooked day"
          >
            <WeekIllustration />
          </div>
        </section>

        <section
          className="features"
          id="features"
          aria-label="What Orbyn does"
        >
          {FEATURES.map(([title, body]) => (
            <article key={title}>
              <h2>{title}</h2>
              <p className="muted">{body}</p>
            </article>
          ))}
        </section>

        <section className="faq" id="questions">
          <h2>Before you start</h2>
          {FAQ.map(({ q, a }) => (
            <details key={q}>
              <summary>{q}</summary>
              <p className="muted">{a}</p>
            </details>
          ))}
        </section>
      </main>
    </PublicFrame>
  );
}
