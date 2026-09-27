import { useEffect, useState, type MouseEvent } from "react";
import { ArrowUpRight, Orbit } from "lucide-react";
import {
  CHANGELOG,
  CHANGELOG_HEADINGS,
  CHANGELOG_SECTIONS,
  releaseDate,
} from "@orbyn/core";
import { Select } from "../../components/Select";
import {
  Releases,
  releaseAnchor,
  releaseMatches,
  type SectionFilter,
} from "./Releases";
import "../status/status.css";
import "../legal/legal.css";
import "./whatsnew.css";

type Props = {
  signedIn: boolean;
  onNavigate: (path: string) => void;
  onHome?: () => void;
};

const FILTERS: SectionFilter[] = ["all", ...CHANGELOG_SECTIONS];
const filterLabel = (f: SectionFilter) =>
  f === "all" ? "Everything" : CHANGELOG_HEADINGS[f];

/** The release a /changelog#release-<id> link points at, if any. */
const linkedRelease = () => {
  const hash = typeof location === "undefined" ? "" : location.hash.slice(1);
  return CHANGELOG.find((r) => releaseAnchor(r.id) === hash)?.id ?? null;
};

/** Brings a release's card into view and puts focus on its toggle. */
const reveal = (id: string) =>
  requestAnimationFrame(() => {
    const card = document.getElementById(releaseAnchor(id));
    if (!card) return;
    card.scrollIntoView({ block: "start", behavior: "smooth" });
    card.querySelector<HTMLButtonElement>(".release-toggle")?.focus({
      preventScroll: true,
    });
  });

/**
 * The public changelog (/changelog, DSN-03): every release, newest first,
 * in the same frame as Security and data and the status page. The newest is
 * open and the rest fold to their date, title and summary; a filter shows
 * one heading across every release, and the jump list opens any one. The
 * apps' "What's new" sheet reads the same list.
 */
export function ChangelogPage({ signedIn, onNavigate, onHome }: Props) {
  const [filter, setFilter] = useState<SectionFilter>("all");
  const [open, setOpen] = useState<string[]>(() => {
    const linked = linkedRelease();
    return linked ? [linked] : CHANGELOG.slice(0, 1).map((r) => r.id);
  });

  useEffect(() => {
    const linked = linkedRelease();
    if (linked) reveal(linked);
  }, []);

  const go = (path: string) => (e: MouseEvent) => {
    e.preventDefault();
    onNavigate(path);
  };
  const goHome = (e: MouseEvent) => {
    e.preventDefault();
    if (onHome) onHome();
    else onNavigate(signedIn ? "/app" : "/login");
  };

  const shown = CHANGELOG.filter((r) => releaseMatches(r, filter));
  const allOpen = shown.every((r) => open.includes(r.id));
  const toggle = (id: string) =>
    setOpen((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
    );
  const chooseFilter = (next: SectionFilter) => {
    setFilter(next);
    // One heading across releases reads best with every release open.
    setOpen(
      next === "all"
        ? CHANGELOG.slice(0, 1).map((r) => r.id)
        : CHANGELOG.filter((r) => releaseMatches(r, next)).map((r) => r.id),
    );
  };
  const jump = (id: string) => {
    if (!id) return;
    if (!shown.some((r) => r.id === id)) setFilter("all");
    setOpen((ids) => (ids.includes(id) ? ids : [...ids, id]));
    history.replaceState(null, "", `#${releaseAnchor(id)}`);
    reveal(id);
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
          <div className="changelog-tools">
            <div
              className="changelog-filter"
              role="radiogroup"
              aria-label="Show"
            >
              {FILTERS.map((f) => (
                <button
                  key={f}
                  type="button"
                  role="radio"
                  aria-checked={filter === f}
                  onClick={() => chooseFilter(f)}
                >
                  {filterLabel(f)}
                </button>
              ))}
            </div>
            <div className="changelog-jump">
              <Select
                value=""
                aria-label="Jump to a release"
                onChange={(e) => jump(e.target.value)}
              >
                <option value="">Jump to a release…</option>
                {CHANGELOG.map((r) => (
                  <option key={r.id} value={r.id}>
                    {`${releaseDate(r)}: ${r.title}`}
                  </option>
                ))}
              </Select>
              <button
                type="button"
                className="text-button"
                onClick={() => setOpen(allOpen ? [] : shown.map((r) => r.id))}
              >
                {allOpen ? "Fold all" : "Open all"}
              </button>
            </div>
          </div>
          <Releases filter={filter} open={open} onToggle={toggle} />
          <p className="changelog-foot">
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
