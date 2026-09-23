import { colors, statusTones } from "@orbyn/core";
import { renderToString } from "react-dom/server";
import { HomePage } from "./features/home/HomePage";
import { FAQ } from "./features/home/faq";

/**
 * The homepage as HTML, for scripts/prerender-home.mjs to write into
 * index.html at build time. Built by Vite in SSR mode, never shipped to a
 * browser.
 *
 * Without it the page a crawler or a link preview receives is an empty div:
 * Google runs the script eventually, but not every crawler runs any, and the
 * words that describe Orbyn would reach none of them.
 */
export function renderHome() {
  // As a first-time visitor sees it; the app re-renders for anyone signed in.
  const html = renderToString(
    <HomePage signedIn={false} onNavigate={() => {}} />,
  );

  // The palette main.tsx adds at start-up, so the page is drawn in its own
  // colours before the script arrives, not in the browser's defaults.
  const palette = [
    ...Object.entries(colors).map(
      ([name, value]) => `--color-${name}:${value};`,
    ),
    ...Object.entries(statusTones).map(
      ([status, tone]) =>
        `--status-${status}-bg:${tone.bg};--status-${status}-fg:${tone.fg};`,
    ),
  ].join("");

  // The questions the page shows, as FAQPage data: the same list, word for
  // word, so what search engines are told is what a visitor reads.
  const faq = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.map(({ q, a }) => ({
      "@type": "Question",
      name: q,
      acceptedAnswer: { "@type": "Answer", text: a },
    })),
  };

  return {
    html,
    palette: `:root,.theme-light{${palette}}`,
    // "<" is escaped so no answer can ever close the script element early.
    faqLd: JSON.stringify(faq).replace(/</g, "\\u003c"),
  };
}
