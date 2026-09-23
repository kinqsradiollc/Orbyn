import type { FastifyInstance } from "fastify";
import {
  fail,
  announcementInput,
  maintenanceInput,
  systemSettingsUpdate,
  testEmailInput,
  type UpdateInfo,
} from "@orbyn/core";
import { env } from "../../config/env.js";
import { transaction, type Db } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { authorize } from "../../lib/auth.js";
import { strictRateLimit } from "../../lib/params.js";
import { encryptSecret } from "../../lib/secrets.js";
import {
  invalidateSettings,
  settings,
  settingsView,
} from "../../lib/settings.js";
import { versionInfo } from "../../lib/version.js";
import { sendTestEmail } from "../../worker/channels/email.js";

const save = (db: Db, key: string, value: unknown, by: string) =>
  db.query(
    `INSERT INTO system_settings(key, value, updated_by, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [key, JSON.stringify(value), by],
  );

let updateCache: { at: number; info: UpdateInfo } | null = null;

/** The running build against the newest commit on GitHub (cached a minute). */
async function checkUpdates(): Promise<UpdateInfo> {
  const current = versionInfo("api");
  if (updateCache && Date.now() - updateCache.at < 60_000)
    return { ...updateCache.info, current };
  const repo = env.UPDATE_REPO.trim();
  const deploy_url =
    env.DEPLOY_URL ||
    (repo ? `https://github.com/${repo}/actions/workflows/deploy.yml` : null);
  const base = { current, deploy_url, latest: null, available: false };
  if (!repo) return { ...base, checks_enabled: false, error: null };
  let info: UpdateInfo;
  try {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/commits/${encodeURIComponent(env.UPDATE_BRANCH)}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "orbyn-update-check",
          ...(env.GITHUB_TOKEN
            ? { Authorization: `Bearer ${env.GITHUB_TOKEN}` }
            : {}),
        },
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!res.ok) {
      info = {
        ...base,
        checks_enabled: true,
        error:
          res.status === 404
            ? "GitHub could not find that repository. Private repositories need GITHUB_TOKEN."
            : `GitHub answered HTTP ${res.status}.`,
      };
    } else {
      const body = (await res.json()) as {
        sha: string;
        html_url: string;
        commit: {
          message: string;
          committer?: { date?: string };
          author?: { date?: string };
        };
      };
      info = {
        ...base,
        checks_enabled: true,
        latest: {
          version: body.sha.slice(0, 7),
          message: body.commit.message.split("\n")[0].slice(0, 200),
          date: body.commit.committer?.date ?? body.commit.author?.date ?? "",
          url: body.html_url,
        },
        available:
          current.version !== "dev" && !body.sha.startsWith(current.version),
        error: null,
      };
    }
  } catch {
    info = { ...base, checks_enabled: true, error: "Could not reach GitHub." };
  }
  updateCache = { at: Date.now(), info };
  return info;
}

/**
 * System settings, maintenance mode, and updates. Settings changed here apply
 * on every instance within about 10 seconds, with no restart.
 */
export async function systemRoutes(app: FastifyInstance) {
  /** Public, so apps can show a banner before and after sign-in. */
  app.get("/maintenance", async () => (await settings()).maintenance);

  /** The admins' notice to everyone, or null when there is none (or it ended). */
  app.get("/announcement", async () => {
    const a = (await settings()).announcement;
    if (!a.message || (a.until && Date.parse(a.until) < Date.now()))
      return null;
    return a;
  });

  app.put("/admin/announcement", async (r) => {
    const actor = await authorize(r, "system:manage");
    const d = announcementInput.parse(r.body ?? {});
    await transaction(async (db) => {
      await save(db, "announcement", d, actor.id);
      await audit(
        {
          actorId: actor.id,
          action: d.message
            ? "system.announcement_set"
            : "system.announcement_cleared",
          targetType: "system",
          targetId: "announcement",
          details: { message: d.message, tone: d.tone, until: d.until },
        },
        db,
      );
    });
    invalidateSettings();
    return (await settings()).announcement;
  });

  app.get("/admin/settings", async (r) => {
    await authorize(r, "system:manage");
    invalidateSettings();
    return settingsView(await settings());
  });

  app.put("/admin/settings", async (r) => {
    const actor = await authorize(r, "system:manage");
    const d = systemSettingsUpdate.parse(r.body ?? {});
    invalidateSettings();
    const before = await settings();
    const changed: string[] = [];
    await transaction(async (db) => {
      for (const key of [
        "cors_origins",
        "rate_limit_per_minute",
        "notifier_concurrency",
        "status_interval_ms",
      ] as const)
        if (d[key] !== undefined) {
          await save(db, key, d[key], actor.id);
          changed.push(key);
        }
      if (d.smtp) {
        const { password, ...rest } = d.smtp;
        const was = before.smtp;
        // The first save in the app keeps the .env password unless replaced.
        let password_encrypted = was.from_env
          ? env.SMTP_PASSWORD
            ? await encryptSecret(env.SMTP_PASSWORD)
            : null
          : was.password_encrypted;
        if (password !== undefined)
          password_encrypted = password ? await encryptSecret(password) : null;
        await save(
          db,
          "smtp",
          {
            host: rest.host ?? was.host,
            port: rest.port ?? was.port,
            user: rest.user ?? was.user,
            secure: rest.secure ?? was.secure,
            from: rest.from ?? was.from,
            password_encrypted,
          },
          actor.id,
        );
        changed.push(password === undefined ? "smtp" : "smtp (password)");
      }
      for (const key of d.reset ?? []) {
        await db.query("DELETE FROM system_settings WHERE key=$1", [key]);
        changed.push(`${key} (reset to .env)`);
      }
      await audit(
        {
          actorId: actor.id,
          action: "system.settings_changed",
          targetType: "system",
          targetId: "settings",
          details: { changed },
        },
        db,
      );
    });
    invalidateSettings();
    return settingsView(await settings());
  });

  app.post("/admin/settings/test-email", strictRateLimit, async (r) => {
    const actor = await authorize(r, "system:manage");
    const d = testEmailInput.parse(r.body ?? {});
    const to = d.to ?? actor.email;
    invalidateSettings();
    try {
      await sendTestEmail(to);
    } catch (error) {
      fail(
        502,
        `The test email could not be sent: ${(error as Error).message.slice(0, 200)}`,
      );
    }
    return { sent: true as const, to };
  });

  app.put("/admin/maintenance", async (r) => {
    const actor = await authorize(r, "system:manage");
    const d = maintenanceInput.parse(r.body ?? {});
    await transaction(async (db) => {
      await save(db, "maintenance", d, actor.id);
      await audit(
        {
          actorId: actor.id,
          action: d.enabled
            ? "system.maintenance_on"
            : "system.maintenance_off",
          targetType: "system",
          targetId: "maintenance",
          details: { message: d.message, until: d.until },
        },
        db,
      );
    });
    invalidateSettings();
    return (await settings()).maintenance;
  });

  app.get("/admin/updates", async (r) => {
    await authorize(r, "system:manage");
    return checkUpdates();
  });
}
