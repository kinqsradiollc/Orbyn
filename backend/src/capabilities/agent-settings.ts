import { agentSettingsInput } from "@orbyn/core";
import { appLinkFor, appUrl } from "./refs.js";
import { CapabilityError, defineCapability } from "./registry.js";
import {
  EDITS,
  clientRefInput,
  dbOf,
  destination,
  finishWrite,
  writeOutput,
} from "./write.js";

const input = agentSettingsInput.extend({ client_ref: clientRefInput });

type IdentityRow = {
  name: string;
  persona: string;
  named_at: Date | null;
  updated_at: Date;
};

/** Rename the person's own assistant through the same proposal and undo path as other agent writes. */
export const updateAgent = defineCapability({
  name: "update_agent",
  title: "Change your agent",
  description:
    "Changes the name and persona of your Orbyn agent. Personal only. Changes that need your approval wait in Review; direct changes have Undo.",
  input,
  output: writeOutput,
  annotations: EDITS,
  access: "suggest",
  toolset: "core",
  mode: "write",
  tier: "W2",
  async run(ctx, a) {
    const p = ctx.principal;
    if (!p.personal)
      throw new CapabilityError(
        "FORBIDDEN",
        "Changing your agent needs access to Personal.",
        "Give this connection Personal access, then try again.",
      );
    const db = dbOf(ctx);
    const before = (
      await db.query<IdentityRow>(
        `SELECT name, persona, named_at, updated_at
           FROM agent_settings WHERE user_id = $1 FOR UPDATE`,
        [p.user.id],
      )
    ).rows[0];
    if (
      before?.name === a.name &&
      before.persona === a.persona &&
      before.named_at
    )
      throw new CapabilityError(
        "INVALID",
        "Your agent already has those details.",
      );

    const where = destination(ctx, null, "W2", [], {
      asks: "profile",
      why: "it changes your agent's name or persona",
    });
    if (where === "review")
      return finishWrite(ctx, "Changing your agent", {
        done: [],
        review: [
          {
            type: "agent.update",
            title: before?.name ?? "Your agent",
            team_id: null,
            name: a.name,
            persona: a.persona,
            before_name: before?.name ?? null,
            before_persona: before?.persona ?? null,
            before_updated_at: before?.updated_at.toISOString() ?? null,
          },
        ],
        reviewSummary: `Change your agent to “${a.name}”`,
      });

    const saved = (
      await db.query<IdentityRow>(
        `INSERT INTO agent_settings (user_id, name, persona, named_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (user_id) DO UPDATE SET name = EXCLUDED.name,
           persona = EXCLUDED.persona,
           named_at = coalesce(agent_settings.named_at, now()),
           updated_at = now()
         RETURNING name, persona, named_at, updated_at`,
        [p.user.id, a.name, a.persona],
      )
    ).rows[0];
    await db.query(
      `UPDATE agent_grants SET name = $2, client_name = $2
        WHERE user_id = $1 AND kind = 'assistant' AND revoked_at IS NULL`,
      [p.user.id, saved.name],
    );
    return {
      structured: {
        status: "done" as const,
        done: [
          {
            id: "settings:agent",
            title: saved.name,
            url: `${appUrl()}/app/settings`,
            app_url: appLinkFor(`${appUrl()}/app/settings`),
            version: null,
            change: "Changed the name and persona",
          },
        ],
        pending: null,
        skipped: [],
      },
      markdown: `Your agent is now called ${saved.name}. Its persona was updated.`,
      write: {
        undo: [
          {
            op: "agent_settings.restore",
            user_id: p.user.id,
            expected_updated_at: saved.updated_at.toISOString(),
            previous: before
              ? {
                  name: before.name,
                  persona: before.persona,
                  named_at: before.named_at?.toISOString() ?? null,
                }
              : null,
          },
        ],
        team_id: null,
      },
    };
  },
});
