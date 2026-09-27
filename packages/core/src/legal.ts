import { z } from "zod";

/**
 * The Terms of Service and Privacy Policy. Orbyn ships a starting text for
 * each; an admin fills in who runs the service and how to reach them, may
 * replace either text, and publishes a new version, after which everyone is
 * asked to accept again. Placeholders in {{double braces}} are filled from the
 * admin's settings when a document is served.
 *
 * These drafts describe what Orbyn actually does with data. They are not
 * legal advice: whoever runs Orbyn should have them reviewed before launch.
 */

export const LEGAL_DOCS = ["terms", "privacy"] as const;
export type LegalDoc = (typeof LEGAL_DOCS)[number];

export const LEGAL_TITLES: Record<LegalDoc, string> = {
  terms: "Terms of Service",
  privacy: "Privacy Policy",
};

/** The version the shipped texts carry until an admin publishes another. */
export const DEFAULT_LEGAL_VERSION = "2026-09-26";

/**
 * The youngest someone may be to make an account. 16 is the highest age of
 * digital consent in the EU (GDPR art. 8), so it holds everywhere; COPPA's 13
 * in the US is covered by it.
 */
export const MINIMUM_AGE = 16;

export type LegalSettings = {
  /** The legal name of whoever runs this Orbyn. */
  company: string;
  /** Where privacy requests and legal notices go. */
  contact_email: string;
  /** Whose law governs the terms, e.g. "the State of Delaware, USA". */
  jurisdiction: string;
  /** Services that process data for Orbyn, one per line (hosting, email…). */
  processors: string;
  terms: { version: string; body: string | null; updated_at: string | null };
  privacy: { version: string; body: string | null; updated_at: string | null };
};

export const defaultLegalSettings = (): LegalSettings => ({
  company: "",
  contact_email: "",
  jurisdiction: "",
  processors: "",
  terms: { version: DEFAULT_LEGAL_VERSION, body: null, updated_at: null },
  privacy: { version: DEFAULT_LEGAL_VERSION, body: null, updated_at: null },
});

/** What anyone may read: the current versions and who runs the service. */
export type LegalSummary = {
  company: string;
  contact_email: string;
  /** The agreement version: what sign-up and the consent prompt accept. */
  terms_version: string;
  privacy_version: string;
  minimum_age: number;
};

export type LegalDocument = {
  doc: LegalDoc;
  title: string;
  version: string;
  /** Markdown: `#`/`##` headings, `-` lists, blank-line paragraphs. */
  body: string;
};

/** The admin view: settings, the shipped texts, and who has accepted. */
export type LegalAdminView = {
  settings: LegalSettings;
  defaults: Record<LegalDoc, string>;
  /** Things still to fill in before the documents are complete. */
  missing: string[];
  accepted_current: number;
  users: number;
  analytics_opted_out: number;
};

export const legalSettingsUpdate = z
  .object({
    company: z.string().trim().max(160).optional(),
    contact_email: z
      .union([z.literal(""), z.string().trim().pipe(z.email().max(254))])
      .optional(),
    jurisdiction: z.string().trim().max(160).optional(),
    processors: z.string().trim().max(4000).optional(),
    /** Null goes back to the shipped text. */
    terms_body: z.string().trim().min(1).max(60000).nullable().optional(),
    privacy_body: z.string().trim().min(1).max(60000).nullable().optional(),
    /** Publish a new version of these, so everyone is asked to accept again. */
    publish: z.array(z.enum(LEGAL_DOCS)).max(2).optional(),
  })
  .strict();
export type LegalSettingsUpdate = z.infer<typeof legalSettingsUpdate>;

/** Sign-up's agreement, and accepting a new version later. */
export const acceptTermsInput = z
  .object({ terms_version: z.string().trim().min(1).max(40) })
  .strict();

export const privacyUpdate = z
  .object({ analytics_opt_out: z.boolean() })
  .strict();

export type ConsentEntry = {
  kind: "terms" | "analytics";
  version: string | null;
  granted: boolean;
  at: string;
};

export type PrivacyView = {
  terms_version: string | null;
  terms_accepted_at: string | null;
  current_terms_version: string;
  analytics_opt_out: boolean;
  history: ConsentEntry[];
};

/** Deleting your own account: the password, or your email if you have none. */
export const deleteAccountInput = z
  .object({
    password: z.string().min(1).max(128).optional(),
    confirm_email: z.string().trim().max(254).optional(),
  })
  .strict();

/** Order two versions ("2026-09-23", "2026-09-23.2"). */
export function compareLegalVersions(a: string, b: string): number {
  const [da, na] = a.split(".");
  const [db, nb] = b.split(".");
  if (da !== db) return da < db ? -1 : 1;
  return (Number(na) || 1) - (Number(nb) || 1);
}

/**
 * The version people agree to: the newer of the two documents, so publishing
 * either the Terms or the Privacy Policy asks everyone to review it.
 */
export function agreementVersion(s: LegalSettings): string {
  return compareLegalVersions(s.terms.version, s.privacy.version) >= 0
    ? s.terms.version
    : s.privacy.version;
}

/** A version newer than `previous`: today's date, with a suffix when repeated. */
export function nextLegalVersion(previous: string, today: string): string {
  if (!previous.startsWith(today)) return today;
  const n = Number(previous.slice(today.length + 1)) || 1;
  return `${today}.${n + 1}`;
}

/** Fill a document's {{placeholders}} from the admin's settings. */
export function renderLegal(doc: LegalDoc, s: LegalSettings): LegalDocument {
  const company = s.company || "the operator of this Orbyn service";
  const contact = s.contact_email || "the contact address shown in the app";
  const processors = s.processors
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const values: Record<string, string> = {
    company,
    contact,
    jurisdiction:
      s.jurisdiction || "the place where the operator is established",
    version: s[doc].version,
    minimum_age: String(MINIMUM_AGE),
    processors: processors.length
      ? processors.map((p) => `- ${p}`).join("\n")
      : "- The current list is available on request from " + contact + ".",
  };
  const body = (s[doc].body ?? LEGAL_DEFAULTS[doc]).replace(
    /\{\{(\w+)\}\}/g,
    (m, key: string) => values[key] ?? m,
  );
  return { doc, title: LEGAL_TITLES[doc], version: s[doc].version, body };
}

/** What an admin still has to fill in for the documents to be complete. */
export function legalMissing(s: LegalSettings): string[] {
  const missing: string[] = [];
  if (!s.company) missing.push("company");
  if (!s.contact_email) missing.push("contact_email");
  if (!s.jurisdiction) missing.push("jurisdiction");
  if (!s.processors) missing.push("processors");
  return missing;
}

const TERMS = `# Terms of Service

Version {{version}}

These terms are an agreement between you and {{company}} ("we", "us"), which runs this Orbyn service. By creating an account or using Orbyn you agree to them and to our Privacy Policy. If you don't agree, don't use Orbyn.

## Who can use Orbyn

You must be at least {{minimum_age}} years old. If you use Orbyn for an organisation, you confirm you may accept these terms for it.

## Your account

Keep your password, passkeys and recovery codes safe, and tell us at {{contact}} if you think someone else has used your account. You are responsible for what happens under your account.

## Your content

What you put into Orbyn — tasks, pages, notes, projects, calendars and files — stays yours. You give us permission to store, copy, process and display it only as needed to run Orbyn for you and the people you share it with, including sending it to the AI service when you use the assistant. You can export or delete it at any time.

You must have the right to everything you put into Orbyn.

## Acceptable use

Don't use Orbyn to break the law or anyone's rights; send spam or malware; harass anyone; try to reach accounts or data that aren't yours; probe, overload or disrupt the service; or get around limits or security. We may suspend or close an account that does, and we'll tell you why unless the law or safety stops us.

## The assistant

Orbyn's assistant suggests changes; nothing changes until you approve it. Its suggestions can be wrong, so check them before relying on them.

## Connected agents

You can connect outside AI agents and apps (such as Claude or ChatGPT) to your Orbyn, by signing in with Orbyn or with an agent key. You choose what each one may do and in which spaces, and you can change or disconnect it at any time in Settings → Connected agents. What a connected agent does on your behalf counts as your own use of Orbyn, and the agent's own provider handles what Orbyn sends it under that provider's terms, not ours. Team owners and admins can limit or turn off outside agents in their team.

## Teams and sharing

When you share with a team or a public page, the people you share with can see and sometimes change that content. Team owners and admins manage who belongs to a team.

## Changes to Orbyn and to these terms

We improve Orbyn over time and may change or remove features. If we change these terms in a way that matters, we'll ask you to accept the new version before you carry on.

## Ending your account

You can delete your account at any time in Settings. We may close accounts that break these terms. Sections that by their nature should last after your account ends — ownership, disclaimers and limits of liability — still apply.

## Disclaimers

Orbyn is provided "as is". As far as the law allows, we make no promises that it will be uninterrupted or error-free, or fit a particular purpose. Keep your own copies of anything important.

## Limits of liability

As far as the law allows, we are not liable for indirect or consequential losses, or for lost profits or data. Nothing in these terms limits liability that the law says can't be limited, or your rights as a consumer where you live.

## Governing law

These terms are governed by the law of {{jurisdiction}}, without affecting any consumer protection you have under the law where you live.

## Contact

Questions about these terms: {{contact}}.
`;

const PRIVACY = `# Privacy Policy

Version {{version}}

This policy explains what personal data {{company}} ("we") collects when you use Orbyn, why, how long we keep it, and the choices and rights you have. We don't sell your data, we don't show ads, and we don't use third-party trackers.

## What we collect

- **Your account:** your name, email address, password (stored only as a one-way hash), passkeys, two-step settings and preferences.
- **What you put into Orbyn:** tasks, pages, notes, projects, comments, calendars you connect, booking pages and the answers people give on them, the flashcards in your pages with how your reviews went, files you import into Docs (PDFs, Word documents and photos of notes), pictures, files and audio recordings you add to pages, and what you save from web pages with the Orbyn Clipper browser extension (the page's address, its readable text, and passages you highlight).
- **Sign-ins:** the device and browser you signed in from and when each session was last used, so you can see and end them.
- **Requests to our servers:** the address requested, when, how long it took, the result, and which account made it. We use this to run, secure and debug Orbyn.
- **Usage analytics:** per day, how many requests, changes and assistant requests your account made. This never includes what you wrote. You can turn it off.

## Why we use it

- To provide Orbyn to you and the people you share with (performing our contract with you).
- To keep Orbyn secure, prevent abuse and fix problems (our legitimate interest).
- To understand which features are used so we can improve them (our legitimate interest — you can object by turning analytics off).
- To send the emails and notifications you've asked for, and messages about your account.
- To meet legal obligations.

## The assistant

When you use the assistant, the content it needs to answer — your question and the relevant tasks, pages or calendar — is sent to the AI service we use to produce the answer. The same goes for Study when you ask it to suggest flashcards, check an answer or explain a card: the page the cards come from is sent. Reviewing cards never uses the AI service. When you ask for a summary of a recording you made in a page, the recording is sent to the AI service to be written out, and the written-out words to be summarised; recordings are never sent anywhere unless you ask. Team owners and admins can keep a team's pages out of the assistant altogether. It isn't used to show you ads. The assistant only proposes changes; nothing is changed until you approve it.

## Connected agents

If you connect an outside AI agent or app to Orbyn (for example Claude, ChatGPT or a coding tool), by signing in with Orbyn or with an agent key, it can read, and if you allow it change, what you chose on the connection screen: your personal space, the teams you picked, and the kinds of things you turned on. Whatever it reads is sent to that app and its provider, who handle it under their own privacy policy; we don't control what they do with it. Guests' names and contact details from bookings are only included when you turn Bookings on for that connection. For each connection we keep its app's name and website, what you allowed, when it was last used, and a log of what it did (kept 180 days) so you can review and undo its changes; its sign-in is stored only as a one-way hash. We email you and show a notice when a new connection is made, and end every connection when you reset your password. Team owners and admins see which members' agents can reach their team (by name and app, never what they did in your personal space). Counts of agent calls are part of usage analytics and follow your analytics choice. Each connection also has an inbox of what happened in the spaces it reaches (kept 14 days), the questions it asks you with your answers, and the standing rules you write for your agents. If you give a connection a wake-up address, Orbyn calls that address with only how many things wait and of which kinds, never what they say.

## Files you import

When you import a PDF, Word document or photo into Docs, the file is stored encrypted on Orbyn's own servers only while it's turned into a page, then deleted. Scanned pages and photos are read by a text-recognition model that runs on our servers; the file is never sent to the AI service or anyone else. The file is deleted as soon as the import finishes, fails or is cancelled, and in any case within 24 hours. Only the page it became stays, like any page you write, with a note of the file's name — unless you choose "Keep the original", when the file stays with its page as described below.

## Pictures and files in pages

Pictures, files and audio recordings you add to a page, and the originals of imports you chose to keep, are stored encrypted on Orbyn's own servers (never a third-party storage service), for as long as a page shows them. Whoever can open a page that shows one can see or download it, through links that last an hour. They count against your space for files, which a page's Info shows. When you delete a file from a page's Info, it's deleted within a few hours. When no page shows it any more — its line was removed, or its page was deleted for good — it's deleted 30 days after its line was removed (so undo and page history can bring it back), or within a few hours of its page being deleted for good. They are included in our backups.

If you turn on "Keep the original" (off unless you choose it), the file itself is kept too, encrypted on Orbyn's own servers and included in our backups, for as long as the page it became exists. It is never sent to the AI service or anyone else. Whoever can open the page can download it. It comes with your full export, and it is deleted when you delete it, when its page is deleted for good, or when you delete your account.

## Search by meaning

Search by meaning is off unless your workspace's administrator turns it on. When it's on, the words of every page (except pages in projects kept out of the assistant) are sent to the AI service to be measured, so a search can find a page that says the same thing in other words. The measurements are kept in Orbyn's database, and deleted when the page is, or when search by meaning is turned off.

## Keeping a project out of the assistant

The owner of a project (or a team's owners and admins) can keep it out of the assistant. Nothing in it — its tasks, pages, records or title — is then sent to the AI service or to connected agents, by the assistant, Study, the morning agenda or search by meaning.

## Who we share it with

We share data only with services that process it for us under contract, only as needed:

{{processors}}

and with people you choose to share with in Orbyn, or when the law requires it. We never sell or rent personal data, and never share it for cross-context behavioural advertising.

## Cookies and storage in your browser

Orbyn stores only what it needs in your browser: your sign-in, and settings such as theme and layout. These are strictly necessary, so they don't need your consent. We use no advertising or analytics cookies, and fonts are served by Orbyn itself.

## How long we keep it

- Your account and content: until you delete them or your account.
- Deleted items: 90 days, so you can restore them.
- Request logs: 7 days. Daily usage counts and study review history: about 13 months.
- Files you import: deleted once they're read, and always within 24 hours, unless you keep the original. The record of each import (its file name and outcome): 30 days.
- Pictures and files in pages: as long as a page shows them; 30 days once none does, or until you delete them from a page's Info.
- Security audit records: 2 years.
- Expired sign-ins and email links: removed automatically.

Backups may keep copies for a short time after deletion before they are overwritten.

## Your rights

Depending on where you live (including under the GDPR, the UK GDPR, and US state laws such as the CCPA/CPRA), you can:

- **Access and port your data:** Settings → Privacy → Download my data.
- **Correct it:** edit it in Orbyn, or ask us.
- **Delete it:** Settings → Privacy → Delete my account.
- **Object to analytics:** Settings → Privacy → Usage analytics.
- **Restrict or object** to other processing, and **withdraw consent** where we rely on it.
- **Complain** to your local data protection authority.

We won't treat you differently for using these rights. To use any of them, or if you can't do it in the app, email {{contact}}. We'll answer within one month (45 days in California).

## Security

Connections are encrypted, passwords are hashed, and secrets for connected services are encrypted at rest. Access to production data is limited and logged.

## International transfers

Your data may be processed in countries other than yours. Where the law requires it, we use safeguards such as the European Commission's Standard Contractual Clauses.

## Children

Orbyn isn't for anyone under {{minimum_age}}. If you think a child has made an account, tell us and we'll delete it.

## Changes

If we change this policy in a way that matters, we'll ask you to review it before you carry on using Orbyn.

## Contact

{{company}} — {{contact}}
`;

export const LEGAL_DEFAULTS: Record<LegalDoc, string> = {
  terms: TERMS,
  privacy: PRIVACY,
};
