import { ArrowUpRight, Moon, Orbit, Sun } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import { useAccount } from "../../app/account";
import { navigate } from "../../lib/router";
import { useTheme } from "../../lib/theme";
import { IconButton } from "../../ui/kit";
import "./public.css";

export const go = (path: string) => (event: MouseEvent) => {
  event.preventDefault();
  navigate(path);
};

const SECTIONS = [
  ["/security", "Security and data"],
  ["/privacy", "Privacy Policy"],
  ["/terms", "Terms of Service"],
  ["/status", "Status"],
  ["/changelog", "What's new"],
  ["/developers/mcp", "Developers"],
];

export function PublicFrame({
  children,
  nav,
}: {
  children: ReactNode;
  nav?: ReactNode;
}) {
  const { token } = useAccount();
  const [theme, toggle] = useTheme();
  return (
    <div className="site">
      <header className="site-bar">
        <a
          className="auth-brand"
          href="/"
          onClick={go("/")}
          aria-label="Orbyn home"
        >
          <Orbit aria-hidden="true" /> orbyn
        </a>
        <div className="site-nav">{nav}</div>
        <IconButton
          label={theme === "dark" ? "Use light theme" : "Use dark theme"}
          onClick={toggle}
        >
          {theme === "dark" ? <Sun /> : <Moon />}
        </IconButton>
        {token ? (
          <a className="btn btn-primary" href="/app" onClick={go("/app")}>
            Open your planner <ArrowUpRight aria-hidden="true" />
          </a>
        ) : (
          <>
            <a className="btn btn-ghost" href="/login" onClick={go("/login")}>
              Sign in
            </a>
            <a
              className="btn btn-primary"
              href="/signup"
              onClick={go("/signup")}
            >
              Get started <ArrowUpRight aria-hidden="true" />
            </a>
          </>
        )}
      </header>
      {children}
      <footer className="site-foot small">
        <nav aria-label="About Orbyn">
          {SECTIONS.map(([path, label]) => (
            <a key={path} href={path} onClick={go(path)}>
              {label}
            </a>
          ))}
        </nav>
      </footer>
    </div>
  );
}

/** Legal documents: `#` headings, `-` lists and paragraphs, with **bold**. */
export function PlainText({ body }: { body: string }) {
  const inline = (text: string) =>
    text
      .split(/(\*\*[^*]+\*\*)/g)
      .map((part, i) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <strong key={i}>{part.slice(2, -2)}</strong>
        ) : (
          part
        ),
      );
  return (
    <>
      {body
        .trim()
        .split(/\n{2,}/)
        .map((block, i) => {
          const lines = block.split("\n");
          if (lines.every((line) => line.startsWith("- ")))
            return (
              <ul key={i}>
                {lines.map((line, j) => (
                  <li key={j}>{inline(line.slice(2))}</li>
                ))}
              </ul>
            );
          const heading = block.match(/^(#{1,3}) (.*)$/);
          if (heading && lines.length === 1) {
            const Tag = `h${heading[1].length}` as "h1" | "h2" | "h3";
            return <Tag key={i}>{inline(heading[2])}</Tag>;
          }
          return <p key={i}>{inline(lines.join(" "))}</p>;
        })}
    </>
  );
}
