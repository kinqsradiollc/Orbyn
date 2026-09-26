import type { MouseEvent } from "react";
import { ArrowUpRight, Orbit } from "lucide-react";
import { SECURITY_PAGE, securityPageDate } from "@orbyn/core";
import "../status/status.css";
import "./legal.css";

type Props = {
  signedIn: boolean;
  onNavigate: (path: string) => void;
  onHome?: () => void;
};

/**
 * Security and data (/security, OTH-02): how Orbyn keeps an account safe,
 * dated, in the same frame as the Terms and Privacy Policy. The words are
 * shared with the phone app (packages/core/src/security-page.ts).
 */
export function SecurityPage({ signedIn, onNavigate, onHome }: Props) {
  const go = (path: string) => (e: MouseEvent) => {
    e.preventDefault();
    onNavigate(path);
  };
  const goHome = (e: MouseEvent) => {
    e.preventDefault();
    if (onHome) onHome();
    else onNavigate(signedIn ? "/app" : "/login");
  };

  return (
    <div className="status-page legal-page">
      <header className="status-nav">
        <a href="/" className="brand" aria-label="Orbyn home" onClick={goHome}>
          <Orbit />
          orbyn<span>•</span>
        </a>
        {signedIn ? (
          <a href="/app" className="primary" onClick={go("/app")}>
            Open your planner <ArrowUpRight size={15} />
          </a>
        ) : (
          <a href="/login" className="text-button" onClick={go("/login")}>
            Sign in <ArrowUpRight size={14} />
          </a>
        )}
      </header>
      <main className="status-main legal-main">
        <nav className="legal-switch" aria-label="About your data">
          <a href="/security" aria-current="page" onClick={go("/security")}>
            Security and data
          </a>
          <a href="/privacy" onClick={go("/privacy")}>
            Privacy Policy
          </a>
          <a href="/terms" onClick={go("/terms")}>
            Terms of Service
          </a>
        </nav>
        <article className="legal-text">
          <h1>Security and data</h1>
          <p>Last checked {securityPageDate()}</p>
          {SECURITY_PAGE.map((section) => (
            <section key={section.heading}>
              <h2>{section.heading}</h2>
              <ul>
                {section.lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </section>
          ))}
          <p>
            See also the{" "}
            <a href="/privacy" onClick={go("/privacy")}>
              Privacy Policy
            </a>{" "}
            and the{" "}
            <a href="/status" onClick={go("/status")}>
              service status
            </a>
            .
          </p>
        </article>
      </main>
    </div>
  );
}
