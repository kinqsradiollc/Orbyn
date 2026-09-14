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
  PORT: z.coerce.number().default(8000),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:5173,http://localhost:8080"),
  AI_BASE_URL: z.url().default("https://api.openai.com/v1"),
  AI_API_KEY: z.string().default(""),
  AI_MODEL: z.string().default(""),
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
});

export type Env = z.infer<typeof schema>;
export const env: Env = schema.parse(process.env);

export const adminEmails = new Set(
  env.ADMIN_EMAILS.split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);
