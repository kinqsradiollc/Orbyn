import type { ReactNode } from "react";
import { Orbit } from "lucide-react";
import { useNoIndex } from "../../hooks/useNoIndex";
import "./booking.css";
import "./booking-w3.css";

/** Whether a public page is shown inside another site (`?embed=1`). */
export const isEmbedded = () =>
  new URLSearchParams(window.location.search).get("embed") === "1";

/**
 * The frame around public pages (invites, profiles): the brand, the page
 * and a footer. Embedded pages show only the page itself.
 */
export function PublicShell({
  onHome,
  footer,
  children,
}: {
  /** Absent in the native desktop app, which has no homepage. */
  onHome?: () => void;
  footer: string;
  children: ReactNode;
}) {
  useNoIndex();
  const embed = isEmbedded();
  return (
    <div className={"public-page" + (embed ? " is-embed" : "")}>
      {!embed && (
        <header className="public-nav">
          {onHome ? (
            <a
              className="brand"
              href="/"
              onClick={(e) => {
                e.preventDefault();
                onHome();
              }}
            >
              <Orbit /> orbyn<span>•</span>
            </a>
          ) : (
            <span className="brand">
              <Orbit /> orbyn<span>•</span>
            </span>
          )}
        </header>
      )}
      <main className="public-main">{children}</main>
      {!embed && <footer>{footer}</footer>}
    </div>
  );
}
