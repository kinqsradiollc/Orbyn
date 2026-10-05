import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// The root .env is three levels up from both src/config and dist/config.
loadEnv({
  path: fileURLToPath(new URL("../../../.env", import.meta.url)),
  quiet: true,
});

const schema = z.object({
  /** Private renderer configuration; the browser process has no database/provider credentials. */
  DOC_PDF_URL: z.string().default(""),
  DOC_PDF_KEY: z.string().default(""),
  DOC_PDF_EXECUTABLE: z.string().default("/usr/bin/chromium"),
  DOC_PDF_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(2),
  DATABASE_URL: z
    .string()
    .default("postgres://orbyn:orbyn@localhost:5432/orbyn"),
  /** Optional read replica (or its PgBouncer alias) for reads that tolerate a little lag. */
  DATABASE_READ_URL: z.string().default(""),
  /**
   * Direct line to the primary for LISTEN, which carries live document
   * changes. PgBouncer in transaction pooling can't hold a LISTEN open, so
   * set this to the database itself wherever DATABASE_URL goes through it.
   * Empty means DATABASE_URL is already direct.
   */
  DATABASE_LISTEN_URL: z.string().default(""),
  PORT: z.coerce.number().default(8000),
  /** Deprecated: true is rejected by the notifier; use dedicated assistant services. */
  AI_RUNNER_IN_WORKER: z.enum(["true", "false"]).default("false"),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:5173,http://localhost:8080"),
  SMTP_HOST: z.string().default(""),
  SMTP_PORT: z.coerce.number().default(1025),
  SMTP_USER: z.string().default(""),
  SMTP_PASSWORD: z.string().default(""),
  SMTP_SECURE: z.enum(["true", "false"]).default("false"),
  SMTP_FROM: z.string().default("Orbyn <reminders@orbyn.local>"),
  EXPO_ACCESS_TOKEN: z.string().default(""),
  /** Comma-separated emails that are always system admins. */
  ADMIN_EMAILS: z.string().default(""),
  /** 32 random bytes, base64. Encrypts credentials stored in the database. */
  SECRETS_KEY: z.string().default(""),
  /** "true" when services sit behind the gateway and should trust X-Forwarded-For. */
  TRUST_PROXY: z.enum(["true", "false"]).default("false"),
  /**
   * "true" adds what went wrong technically to error replies (`detail`: the
   * raw validation issues, a server error's own message). Off in production:
   * people see plain messages and the details stay in the logs.
   */
  DEBUG_ERRORS: z.enum(["true", "false"]).default("false"),
  /** How often the status service probes each component. */
  STATUS_INTERVAL_MS: z.coerce.number().int().min(5000).default(30000),
  /** Where the status service reaches each component; empty means this process. */
  STATUS_GATEWAY_URL: z.string().default(""),
  STATUS_API_URL: z.string().default(""),
  STATUS_AI_URL: z.string().default(""),
  STATUS_REALTIME_URL: z.string().default(""),
  STATUS_MCP_URL: z.string().default(""),
  /** Database connections each service process keeps (to Postgres or PgBouncer). */
  DB_POOL_MAX: z.coerce.number().int().min(1).max(200).default(10),
  /**
   * Requests per minute each client may make to a service. 0 leaves general
   * limiting to the gateway; sign-in and AI routes always keep their own limits.
   */
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(0).default(180),
  /** The build running (set by scripts/deploy.sh at image build time). */
  APP_VERSION: z.string().default("dev"),
  BUILD_TIME: z.string().default(""),
  /** "owner/repo" on GitHub for update checks in Admin -> System; empty turns them off. */
  UPDATE_REPO: z.string().default(""),
  UPDATE_BRANCH: z.string().default("main"),
  /** Needed for update checks on a private repository (read-only is enough). */
  GITHUB_TOKEN: z.string().default(""),
  /** Where admins start a deploy; defaults to the repo's deploy workflow. */
  DEPLOY_URL: z.string().default(""),
  /** Parallel delivery lanes in the reminder service. */
  /**
   * Share of ordinary requests kept in the admin request log (0-1). Errors
   * and slow requests are always kept; daily counts always include everything.
   */
  REQUEST_LOG_SAMPLE: z.coerce.number().min(0).max(1).default(1),
  NOTIFIER_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),
  /**
   * Where people open the web app; used in booking links sent by email.
   * The default is the Compose stack's web port. Expo's dev server owns 8081,
   * so a link there would open the mobile bundler instead of the app.
   */
  APP_URL: z.string().default("http://localhost:8080"),
  /** Slack agent-channel installation is disabled until the app and HTTPS callback are configured. */
  SLACK_CLIENT_ID: z.string().default(""),
  SLACK_CLIENT_SECRET: z.string().default(""),
  SLACK_APP_ID: z.string().default(""),
  SLACK_SIGNING_SECRET: z.string().default(""),
  SLACK_REDIRECT_URI: z.string().default(""),
  /**
   * Opening the web app's links in the phone app: the Apple developer team
   * that signs the iOS app, and the SHA-256 fingerprints (comma separated) of
   * the certificates that sign the Android app. Blank serves empty
   * association files, so links stay in the browser.
   */
  APPLE_TEAM_ID: z.string().default(""),
  ANDROID_CERT_FINGERPRINTS: z.string().default(""),
  /**
   * "true" lets webhooks call private network addresses (local development
   * and tests only). Otherwise they must reach a public address.
   */
  ALLOW_PRIVATE_WEBHOOKS: z.enum(["true", "false"]).default("false"),
  /**
   * Email-to-task. The mail server posts inbound mail to /inbound/mail with
   * this shared secret; blank turns the endpoint off. The domain builds each
   * person's address (<slug>@<domain>).
   */
  MAIL_INBOUND_SECRET: z.string().default(""),
  MAIL_INBOUND_DOMAIN: z.string().default(""),
  /**
   * Importing files into Docs. FILES_SECRET signs upload links and the
   * converter's requests to the file store (api, files and converter share
   * it); blank turns importing off. FILES_MASTER_KEY (files only) encrypts
   * each stored file's own key: 32 bytes, base64. FILES_DIR is where the
   * file store keeps uploads, which never outlive a day.
   */
  FILES_SECRET: z.string().default(""),
  FILES_MASTER_KEY: z.string().default(""),
  FILES_URL: z.string().default("http://localhost:8000"),
  FILES_DIR: z.string().default(""),
  /** The file store refuses uploads when less disk than this (MB) would be left. */
  FILES_MIN_FREE_MB: z.coerce.number().int().min(0).default(1024),
  /**
   * "Keep the original": how much each person may keep of the files they
   * imported (MB), stored in FILES_DIR/kept, which must be backed up.
   */
  FILES_KEEP_QUOTA_MB: z.coerce.number().int().min(0).default(500),
  /**
   * Pictures and files in pages (EDT-01): kept by the file store on a volume
   * of their own (PAGE_FILES_DIR; blank keeps them under FILES_DIR/pages),
   * encrypted like uploads, for as long as their page. Each person has
   * PAGE_FILES_QUOTA_MB of space, and one file is at most PAGE_FILES_MAX_MB.
   * Off, like importing, while FILES_SECRET is blank.
   */
  PAGE_FILES_DIR: z.string().default(""),
  PAGE_FILES_QUOTA_MB: z.coerce.number().int().min(1).default(1024),
  PAGE_FILES_MAX_MB: z.coerce.number().int().min(1).max(200).default(25),
  /**
   * The model that writes out recordings made in pages (CAP-10), on the
   * assistant's own provider (its /audio/transcriptions). The ai service
   * fetches a recording from the file store at FILES_URL with a read link
   * it signs, so it needs FILES_SECRET too.
   */
  AI_TRANSCRIBE_MODEL: z.string().default("whisper-1"),
  /**
   * The OCR service (Compose profile `ocr`) for scanned pages and photos.
   * Blank: Word files and PDFs with real text still import; scanned pages
   * are refused with a clear message.
   */
  OCR_URL: z.string().default(""),
  /** Scanned pages read at once; one per OCR worker (`--scale ocr=N`). */
  OCR_WORKERS: z.coerce.number().int().min(1).max(16).default(1),
  /**
   * Scanned pages read at once with the built-in Tesseract (used when
   * OCR_URL is blank). Each takes about one CPU core for a few seconds.
   */
  TESSERACT_WORKERS: z.coerce.number().int().min(1).max(16).default(2),
  /**
   * The formula model (Compose profile `formula`, pix2tex), which reads
   * pictures of equations as LaTeX for scanned pages. Blank: such lines
   * keep a placeholder.
   */
  FORMULA_URL: z.string().default(""),
  /** How long one page may take on CPU before it's given up on. */
  OCR_TIMEOUT_MS: z.coerce.number().int().min(10_000).default(600_000),
  /**
   * The MCP address outside agents connect to: the canonical resource their
   * credentials are for, shown in Settings → Connected agents and in every
   * 401 challenge. Set here, never derived from request headers.
   */
  MCP_PUBLIC_URL: z.string().default("https://mcp.orbyn.dev/mcp"),
  /** Plugin integration recipient; blank keeps plugin routes disabled. */
  PLUGIN_PUBLIC_URL: z.string().default(""),
  /** Who issues agent sign-ins (OAuth, phase A2); defaults to APP_URL. */
  OAUTH_ISSUER: z.string().default(""),
  /** Seconds an agent access token (oat_) lasts. */
  OAUTH_ACCESS_TTL: z.coerce.number().int().min(60).max(86_400).default(3600),
  /** Days an unused agent refresh token (ort_) lasts; 90 at most in all. */
  OAUTH_REFRESH_TTL: z.coerce.number().int().min(1).max(90).default(30),
  /**
   * Where security problems are reported: the Contact line of
   * /.well-known/security.txt (a mailto: or https: address).
   */
  SECURITY_CONTACT: z.string().default("mailto:hello@orbyn.dev"),
  /**
   * The token the OpenAI apps directory gives to prove Orbyn owns the MCP
   * address, answered at /.well-known/openai-apps-challenge (404 when
   * empty). Set only while a directory submission asks for it.
   */
  OPENAI_APPS_CHALLENGE: z
    .string()
    .regex(/^[\w.-]{0,256}$/)
    .default(""),
});

export type Env = z.infer<typeof schema>;
export const env: Env = schema.parse(process.env);

/** The OAuth issuer: OAUTH_ISSUER, or the web app's address. */
export const oauthIssuer = () =>
  (env.OAUTH_ISSUER || env.APP_URL).replace(/\/+$/, "");

export const adminEmails = new Set(
  env.ADMIN_EMAILS.split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);
