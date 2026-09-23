import { useEffect, useState, type MouseEvent } from "react";
import { ArrowUpRight, Orbit } from "lucide-react";
import type { LegalDoc, LegalDocument } from "@orbyn/core";
import { client } from "../../lib/api";
import { LegalText } from "./LegalText";
import "../status/status.css";
import "./legal.css";
import { errorText } from "../../lib/errors";

type Props = {
  doc: LegalDoc;
  signedIn: boolean;
  onNavigate: (path: string) => void;
  onHome?: () => void;
};

/** The public Terms of Service and Privacy Policy (/terms, /privacy). */
export function LegalPage({ doc, signedIn, onNavigate, onHome }: Props) {
  const [document, setDocument] = useState<LegalDocument | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setDocument(null);
    setError("");
    client
      .legalDocument(doc)
      .then((d) => alive && setDocument(d))
      .catch((e: Error) => alive && setError(errorText(e)));
    return () => {
      alive = false;
    };
  }, [doc]);

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
      <main className="status-main legal-main" aria-busy={!document && !error}>
        <nav className="legal-switch" aria-label="Legal documents">
          <a
            href="/terms"
            aria-current={doc === "terms" ? "page" : undefined}
            onClick={go("/terms")}
          >
            Terms of Service
          </a>
          <a
            href="/privacy"
            aria-current={doc === "privacy" ? "page" : undefined}
            onClick={go("/privacy")}
          >
            Privacy Policy
          </a>
        </nav>
        {error ? (
          <p className="legal-error">{error}</p>
        ) : document ? (
          <article>
            <LegalText body={document.body} />
          </article>
        ) : (
          <p className="muted">Loading…</p>
        )}
      </main>
    </div>
  );
}
