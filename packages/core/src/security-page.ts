/**
 * The Security and data page (OTH-02): a short, dated account of how Orbyn
 * keeps an account and its contents safe. The web page (/security) and the
 * phone's Settings show this same text.
 *
 * Every line has to stay true of the product. When one of these changes,
 * change its line and the date.
 */

export type SecuritySection = {
  heading: string;
  lines: string[];
};

/** When the page was last checked against the product (YYYY-MM-DD). */
export const SECURITY_PAGE_UPDATED = "2026-09-27";

/**
 * The one plain answer on data handling (OTH-03): what Orbyn keeps, what
 * the assistant sees, and what is never done with it. The homepage's FAQ
 * and the Security page both show it.
 */
export const DATA_ANSWER = {
  q: "What does Orbyn do with my data?",
  a: "Orbyn keeps what you put into it (your tasks, calendar, pages, files and recordings) on its own servers so your apps stay in step, and nothing else about you beyond what your account needs. The assistant sees only what a request needs, when you ask, and it is sent to the AI service that answers; a team can keep its pages out of it. Your data is never sold or used for ads, the web app loads no third-party trackers, and you can export everything or delete your account at any time. The Security page and the Privacy Policy say exactly how.",
};

export const SECURITY_PAGE: SecuritySection[] = [
  {
    heading: "Signing in",
    lines: [
      "Passwords are stored only as Argon2 hashes, never as the password itself.",
      "Two-step sign-in with an authenticator app, recovery codes and passkeys are in Settings.",
      "Every signed-in browser and phone is listed in Settings, where you can sign any of them out.",
      "Sign-in links and session tokens are kept only as one-way hashes.",
    ],
  },
  {
    heading: "Your data in transit and at rest",
    lines: [
      "The apps talk to Orbyn over HTTPS only.",
      "Keys you save for connected services are encrypted with AES-256-GCM before they are stored.",
      "Files you upload to import are encrypted while they wait, and deleted when the import ends, always within 24 hours.",
      "The web app loads no third-party scripts, fonts or trackers.",
    ],
  },
  {
    heading: "Who can see what",
    lines: [
      "Personal tasks, events and pages are yours alone. Team things are seen by that team, with roles that decide who can change them.",
      "Teammates can see when you are busy, never what you are doing.",
      "The assistant suggests changes and waits for you to approve them.",
      "Outside AI agents see only what you grant when you connect them, and you can disconnect them in Settings at any time.",
      "Team owners and admins can turn off publishing to the web, the assistant on team pages, and booking pages for people outside, for the whole team.",
      "The Orbyn Clipper browser extension signs in with a key that can only save clips: it can't read your pages or change your account.",
    ],
  },
  {
    heading: "Links",
    lines: [
      "A link to a page, task or project opens it only for people who can already see it.",
      "A link that adds something opens it filled in for you to check. Nothing is added until you confirm.",
    ],
  },
  {
    heading: "Leaving with your data",
    lines: [
      "Export everything at any time from Settings: every page as Markdown in its folders, with your projects, folders and tasks.",
      "Deleting your account removes your personal data, as the Privacy Policy describes.",
      "You can turn off usage analytics in Settings.",
    ],
  },
  {
    heading: "Found a problem?",
    lines: [
      "Tell us at the contact address in the Privacy Policy. We read every report and reply.",
    ],
  },
];

/** "26 September 2026", for the page's "Last checked" line. */
export function securityPageDate(locale?: string): string {
  const [y, m, d] = SECURITY_PAGE_UPDATED.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(locale ?? "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** The page as the Markdown the legal documents use (the phone shows it so). */
export function securityPageMarkdown(locale?: string): string {
  return [
    "# Security and data",
    `Last checked ${securityPageDate(locale)}`,
    ...SECURITY_PAGE.flatMap((section) => [
      `## ${section.heading}`,
      section.lines.map((line) => `- ${line}`).join("\n"),
    ]),
  ].join("\n\n");
}
