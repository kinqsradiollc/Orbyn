import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  personalAgentSettingsInput,
  automationAgentLane,
  automationAgentIdentityInput,
  characterAppearance,
  defaultNightShift,
  nightShiftInput,
  type NightShiftSettings,
  fail,
  type AgentContextSettings,
  type PersonalAgentSettings,
  DEFAULT_REMINDER_NUDGES,
  reminderNudgeSettingsInput,
  type ReminderNudgeSettings,
} from "@orbyn/core";
import { pool, reader, transaction } from "../../db/pool.js";
import { authenticate, isApiKeyRequest } from "../../lib/auth.js";
import { audit } from "../../lib/audit.js";
import { idParam, writeRateLimit } from "../../lib/params.js";
import { readAutomationIdentity } from "./identities.js";
import { contextSettings, ensureProfile, setInstructions } from "./service.js";

/**
 * Settings → Connected agents, "About me for agents" and "Instructions"
 * (H8), signed in to Orbyn's own apps only: agents reach the same through
 * get_context, create_doc (kind profile), edit_doc and organize.
 */
async function firstParty(r: FastifyRequest) {
  const u = await authenticate(r);
  if (isApiKeyRequest(r))
    fail(403, "Only you, signed in to Orbyn, can do this. Keys can't.");
  return u;
}

export async function agentContextRoutes(app: FastifyInstance) {
  app.post(
    "/me/assistant/reminder-nudges/:id/stop",
    writeRateLimit,
    async (r): Promise<{ stopped: true }> => {
      const user = await firstParty(r);
      const id = idParam(r);
      await transaction(async (db) => {
        await db.query(
          "SELECT pg_advisory_xact_lock(hashtext('assistant-nudge:' || $1))",
          [user.id],
        );
        const row = (
          await db.query<{ nudge_key: string }>(
            "SELECT nudge_key FROM assistant_nudges WHERE id = $1 AND user_id = $2",
            [id, user.id],
          )
        ).rows[0];
        if (!row) fail(404, "Reminder not found.");
        await db.query(
          `UPDATE assistant_nudges SET stopped = true WHERE id = (
            SELECT id FROM assistant_nudges WHERE user_id = $1 AND nudge_key = $2
            ORDER BY stopped DESC, sent_at DESC, id DESC LIMIT 1
          )`,
          [user.id, row.nudge_key],
        );
        await audit(
          {
            actorId: user.id,
            action: "assistant_reminder_nudges.stop",
            targetType: "user",
            targetId: user.id,
            details: { nudge_id: id },
            requestId: r.id,
          },
          db,
        );
      });
      return { stopped: true };
    },
  );
  app.get(
    "/me/assistant/reminder-nudges",
    async (r): Promise<ReminderNudgeSettings> => {
      const user = await firstParty(r);
      const row = (
        await reader(r.headers).query<{ reminder_nudges: unknown }>(
          "SELECT reminder_nudges FROM agent_settings WHERE user_id = $1",
          [user.id],
        )
      ).rows[0];
      const parsed = reminderNudgeSettingsInput.safeParse(row?.reminder_nudges);
      return parsed.success ? parsed.data : { ...DEFAULT_REMINDER_NUDGES };
    },
  );
  app.put(
    "/me/assistant/reminder-nudges",
    writeRateLimit,
    async (r): Promise<ReminderNudgeSettings> => {
      const user = await firstParty(r);
      const input = reminderNudgeSettingsInput.parse(r.body);
      await transaction(async (db) => {
        await db.query(
          `INSERT INTO agent_settings(user_id, reminder_nudges) VALUES($1, $2::jsonb)
       ON CONFLICT(user_id) DO UPDATE SET reminder_nudges = EXCLUDED.reminder_nudges, updated_at = now()`,
          [user.id, JSON.stringify(input)],
        );
        await audit(
          {
            actorId: user.id,
            action: "assistant_reminder_nudges.set",
            targetType: "user",
            targetId: user.id,
            details: input,
            requestId: r.id,
          },
          db,
        );
      });
      return input;
    },
  );
  app.get(
    "/me/assistant/night-shift",
    async (r): Promise<NightShiftSettings> => {
      const u = await firstParty(r);
      const row = (
        await reader(r.headers).query<{
          night_shift: unknown;
          work_start: string | null;
          work_end: string | null;
          timezone: string | null;
        }>(
          `SELECT a.night_shift, p.work_start::text, p.work_end::text, p.timezone
        FROM users u LEFT JOIN agent_settings a ON a.user_id = u.id
        LEFT JOIN planner_prefs p ON p.user_id = u.id WHERE u.id = $1`,
          [u.id],
        )
      ).rows[0];
      const saved = nightShiftInput.safeParse(row?.night_shift);
      return saved.success
        ? saved.data
        : defaultNightShift({
            work_start: row?.work_start ?? undefined,
            work_end: row?.work_end ?? undefined,
            timezone: row?.timezone ?? undefined,
          });
    },
  );
  app.put(
    "/me/assistant/night-shift",
    async (r): Promise<NightShiftSettings> => {
      const u = await firstParty(r);
      const input = nightShiftInput.parse(r.body);
      const omittedReflection = !Object.hasOwn(
        (r.body as { kinds: Record<string, unknown> }).kinds,
        "reflection",
      );
      return transaction(async (db) => {
        const saved = await db.query<{ night_shift: unknown }>(
          `INSERT INTO agent_settings(user_id, night_shift) VALUES($1, $2::jsonb)
        ON CONFLICT(user_id) DO UPDATE SET night_shift = CASE WHEN $3 THEN
          jsonb_set(EXCLUDED.night_shift, '{kinds,reflection}',
            coalesce(agent_settings.night_shift->'kinds'->'reflection', 'false'::jsonb))
          ELSE EXCLUDED.night_shift END, updated_at = now()
        RETURNING night_shift`,
          [u.id, JSON.stringify(input), omittedReflection],
        );
        await audit(
          {
            actorId: u.id,
            action: "assistant_night_shift.set",
            targetType: "user",
            targetId: u.id,
            details: { enabled: input.enabled },
            requestId: r.id,
          },
          db,
        );
        return nightShiftInput.parse(saved.rows[0].night_shift);
      });
    },
  );
  app.get("/me/assistant/identity/:lane", async (r, reply) => {
    const user = await firstParty(r);
    if (Object.keys(r.query as object).length)
      fail(400, "This route accepts no query parameters.");
    const lane = automationAgentLane.parse((r.params as { lane: string }).lane);
    reply.header("Cache-Control", "private, no-store");
    return readAutomationIdentity(pool, user.id, lane);
  });
  app.put("/me/assistant/identity/:lane", writeRateLimit, async (r, reply) => {
    const user = await firstParty(r);
    if (Object.keys(r.query as object).length)
      fail(400, "This route accepts no query parameters.");
    const lane = automationAgentLane.parse((r.params as { lane: string }).lane);
    const input = automationAgentIdentityInput.parse(r.body);
    const saved = await transaction(async (db) => {
      const changed = await db.query(
        `INSERT INTO automation_agent_identities(user_id,lane,name,persona,character,named_at)
         SELECT $1,$2,$3,$4,coalesce($5::jsonb,'{}'::jsonb),now() WHERE $6::integer=0
         ON CONFLICT(user_id,lane) DO NOTHING RETURNING revision`,
        [
          user.id,
          lane,
          input.name,
          input.persona,
          input.character ? JSON.stringify(input.character) : null,
          input.expected_revision,
        ],
      );
      if (!changed.rowCount) {
        const updated = await db.query(
          `UPDATE automation_agent_identities SET name=$3,persona=$4,
           character=coalesce($5::jsonb,character),named_at=coalesce(named_at,now()),
           updated_at=now(),revision=revision+1
           WHERE user_id=$1 AND lane=$2 AND revision=$6 RETURNING revision`,
          [
            user.id,
            lane,
            input.name,
            input.persona,
            input.character ? JSON.stringify(input.character) : null,
            input.expected_revision,
          ],
        );
        if (!updated.rowCount)
          fail(409, "This agent profile changed. Reload it before saving.");
      }
      await audit(
        {
          actorId: user.id,
          action: "automation_agent_identity.set",
          targetType: "user",
          targetId: user.id,
          details: {
            lane,
            name: input.name,
            persona_length: input.persona.length,
          },
          requestId: r.id,
        },
        db,
      );
      return readAutomationIdentity(db, user.id, lane);
    });
    reply.header("Cache-Control", "private, no-store");
    return saved;
  });

  app.get("/me/agent", async (r): Promise<PersonalAgentSettings> => {
    const u = await firstParty(r);
    const row = (
      await reader(r.headers).query<PersonalAgentSettings>(
        `SELECT name, persona, character, named_at, updated_at FROM agent_settings WHERE user_id = $1`,
        [u.id],
      )
    ).rows[0];
    return row
      ? { ...row, character: characterAppearance(row.character) }
      : {
          name: "Orbyn",
          persona: "",
          character: characterAppearance({}),
          named_at: null,
          updated_at: new Date().toISOString(),
        };
  });

  app.put(
    "/me/agent",
    writeRateLimit,
    async (r): Promise<PersonalAgentSettings> => {
      const u = await firstParty(r);
      const input = personalAgentSettingsInput.parse(r.body);
      const row = await transaction(async (db) => {
        const saved = (
          await db.query<PersonalAgentSettings>(
            `INSERT INTO agent_settings (user_id, name, persona, character, named_at)
       VALUES ($1, $2, $3, coalesce($4::jsonb, '{}'::jsonb), now())
       ON CONFLICT (user_id) DO UPDATE SET name = EXCLUDED.name,
         persona = EXCLUDED.persona, character = coalesce($4::jsonb, agent_settings.character),
         named_at = coalesce(agent_settings.named_at, now()), updated_at = now()
       RETURNING name, persona, character, named_at, updated_at`,
            [
              u.id,
              input.name,
              input.persona,
              input.character ? JSON.stringify(input.character) : null,
            ],
          )
        ).rows[0];
        await db.query(
          `UPDATE agent_grants SET name = $2, client_name = $2
          WHERE user_id = $1 AND kind = 'assistant' AND revoked_at IS NULL`,
          [u.id, saved.name],
        );
        await audit(
          {
            actorId: u.id,
            action: "agent_identity.set",
            targetType: "user",
            targetId: u.id,
            details: { name: input.name, persona_length: input.persona.length },
            requestId: r.id,
          },
          db,
        );
        return { ...saved, character: characterAppearance(saved.character) };
      });
      return {
        ...row,
        named_at: row.named_at ? new Date(row.named_at).toISOString() : null,
        updated_at: new Date(row.updated_at).toISOString(),
      };
    },
  );

  app.get("/me/agent-context", async (r): Promise<AgentContextSettings> => {
    const u = await firstParty(r);
    return contextSettings(reader(r.headers), u.id);
  });

  // Open the profile page, making it first when there isn't one.
  app.post("/me/agent-profile", async (r, reply) => {
    const u = await firstParty(r);
    const made = await transaction((db) => ensureProfile(db, u));
    reply.code(made.created ? 201 : 200);
    return {
      doc_id: made.doc.id,
      title: made.doc.title,
      created: made.created,
    };
  });

  app.put(
    "/me/agent-instructions",
    async (r): Promise<AgentContextSettings> => {
      const u = await firstParty(r);
      await transaction((db) =>
        setInstructions(db, u, null, r.body as never, null, r.id),
      );
      return contextSettings(pool, u.id);
    },
  );

  app.put(
    "/teams/:id/agent-instructions",
    async (r): Promise<AgentContextSettings> => {
      const u = await firstParty(r);
      await transaction((db) =>
        setInstructions(db, u, idParam(r), r.body as never, null, r.id),
      );
      return contextSettings(pool, u.id);
    },
  );
}
