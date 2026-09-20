import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// The root .env is three levels up from both src/config and dist/config.
loadEnv({
  path: fileURLToPath(new URL("../../../.env", import.meta.url)),
  quiet: true,
});

const schema = z.object({
  DATABASE_URL: z
    .string()
    .default("postgres://orbyn:orbyn@localhost:5432/orbyn"),
  /** Optional read replica (or its PgBouncer alias) for reads that tolerate a little lag. */
  DATABASE_READ_URL: z.string().default(""),
  PORT: z.coerce.number().default(8000),
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
  /** How often the status service probes each component. */
  STATUS_INTERVAL_MS: z.coerce.number().int().min(5000).default(30000),
  /** Where the status service reaches each component; empty means this process. */
  STATUS_GATEWAY_URL: z.string().default(""),
  STATUS_API_URL: z.string().default(""),
  STATUS_AI_URL: z.string().default(""),
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
  NOTIFIER_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),
  /**
   * Where people open the web app; used in booking links sent by email.
   * The default is the Compose stack's web port. Expo's dev server owns 8081,
   * so a link there would open the mobile bundler instead of the app.
   */
  APP_URL: z.string().default("http://localhost:8080"),
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
});

export type Env = z.infer<typeof schema>;
export const env: Env = schema.parse(process.env);

export const adminEmails = new Set(
  env.ADMIN_EMAILS.split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);
