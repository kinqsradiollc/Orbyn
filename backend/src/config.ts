import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
loadEnv({
  path: fileURLToPath(new URL("../../.env", import.meta.url)),
  quiet: true,
});
import { z } from "zod";
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
});
export const config = schema.parse(process.env);
