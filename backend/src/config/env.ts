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
});

export type Env = z.infer<typeof schema>;
export const env: Env = schema.parse(process.env);

export const adminEmails = new Set(
  env.ADMIN_EMAILS.split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);
