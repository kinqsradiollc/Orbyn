import type { FastifyInstance } from "fastify";
import {
  dayTime,
  fail,
  localDateKey,
  TEMPLATE_STARTERS,
  templateInput,
  templateUpdate,
  templateUseInput,
  type DocBlock,
  type ProjectTemplate,
  type Proposal,
  type TemplateTask,
} from "@orbyn/core";
import { pool, reader, transaction } from "../../db/pool.js";
import { authenticate } from "../../lib/auth.js";
import { idParam } from "../../lib/params.js";
import { loadPrefs } from "../planner/calendar.js";
import { findProject } from "../projects/service.js";
import {
  COLUMNS,
  type TemplateRow,
  VISIBLE,
  createTemplate,
  deleteTemplate,
  loadTemplate,
  proposeFromTemplate,
  templateFromProject,
  toTemplate,
  updateTemplate,
} from "./service.js";
import { announceWrites } from "../presence/live.js";

/**
 * Project templates: the starters everyone has, your own, and your teams'.
 * Owners and admins make a team's; everyone on the team uses them.
 */
export async function templateRoutes(app: FastifyInstance) {
  announceWrites(app, "templates", "template");
  app.get("/templates", async (r): Promise<ProjectTemplate[]> => {
    const u = await authenticate(r);
    const rows = (
      await reader(r.headers).query<TemplateRow>(
        `SELECT ${COLUMNS} FROM project_templates t
           LEFT JOIN teams tm ON tm.id = t.team_id
          WHERE ${VISIBLE} ORDER BY t.team_id NULLS FIRST, t.name`,
        [u.id],
      )
    ).rows;
    const saved = await Promise.all(rows.map((row) => toTemplate(u, row)));
    const starters: ProjectTemplate[] = TEMPLATE_STARTERS.map((s) => ({
      ...s,
      source: "starter",
      team_id: null,
      team_name: null,
      next_at: null,
      can_edit: false,
      created_at: null,
    }));
    return [...saved, ...starters];
  });

  app.post("/templates", async (r, reply): Promise<ProjectTemplate> => {
    const u = await authenticate(r);
    const d = templateInput.parse(r.body);
    const made = await createTemplate(pool, u, d);
    reply.code(201);
    return made;
  });

  app.put("/templates/:id", async (r): Promise<ProjectTemplate> => {
    const u = await authenticate(r);
    const id = idParam(r);
    const d = templateUpdate.parse(r.body);
    return updateTemplate(pool, u, id, d);
  });

  app.delete("/templates/:id", async (r, reply) => {
    const u = await authenticate(r);
    const id = idParam(r);
    await deleteTemplate(pool, u, id);
    reply.code(204);
  });

  /**
   * Save a project as a template: its open and done tasks, their estimates,
   * when each was due counted from the first, what waits on what, and its
   * brief. Names only; who did what stays with the project.
   */
  app.post(
    "/templates/from-project/:id",
    async (r, reply): Promise<ProjectTemplate> => {
      const u = await authenticate(r);
      const made = await templateFromProject(pool, u, idParam(r));
      reply.code(201);
      return made;
    },
  );

  // Start a project from a template: a proposal to review, never a project yet.
  app.post("/templates/:id/use", async (r): Promise<Proposal> => {
    const u = await authenticate(r);
    const raw = (r.params as { id: string }).id;
    const d = templateUseInput.parse(r.body ?? {});
    const starter = TEMPLATE_STARTERS.find((s) => s.id === raw);
    const saved = starter ? null : await loadTemplate(pool, u, idParam(r));
    const template = starter ?? saved!;
    // A team's template starts a team project unless asked otherwise.
    const teamId =
      d.team_id === undefined ? (saved?.team_id ?? null) : d.team_id;
    return transaction((db) =>
      proposeFromTemplate(db, u, template, { title: d.title, team_id: teamId }),
    );
  });
}
