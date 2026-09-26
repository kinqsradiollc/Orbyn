import type { MouseEvent } from "react";
import { ArrowUpRight, Orbit } from "lucide-react";
import { Releases } from "./Releases";
import "../status/status.css";
import "../legal/legal.css";
import "./whatsnew.css";

type Props = {
  signedIn: boolean;
  onNavigate: (path: string) => void;
  onHome?: () => void;
};

/**
 * The public changelog (/changelog, DSN-03): every release, newest first,
 * in the same frame as Security and data and the status page. The apps'
 * "What's new" sheet reads the same list.
 */
export function ChangelogPage({ signedIn, onNavigate, onHome }: Props) {
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
        <article className="legal-text changelog">
          <h1>What's new</h1>
          <p>Everything that changed in Orbyn, newest first.</p>
          <Releases />
          <p>
            See also the{" "}
            <a href="/status" onClick={go("/status")}>
              service status
            </a>{" "}
            and{" "}
            <a href="/security" onClick={go("/security")}>
              Security and data
            </a>
            .
          </p>
        </article>
      </main>
    </div>
  );
}
