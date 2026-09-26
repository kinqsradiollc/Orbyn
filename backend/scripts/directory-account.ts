// The reviewer account for the agent directories (Anthropic's Connectors
// Directory, OpenAI's apps directory): a plain member with a verified email,
// the current Terms accepted, no two-step sign-in, and a small, believable
// week of a student's work, so a reviewer can try every test case in
// distribution/directory/test-cases.md.
//
//   DIRECTORY_EMAIL=reviewer@orbyn.dev npm run directory:account -w backend
//
// Runs against DATABASE_URL (staging first). Prints the password once;
// running it again resets the password and adds the demo content again only
// if it's missing. It never makes an admin, and refuses to run on a database
// with no admin yet (the first account there would become one).
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import argon2 from "argon2";
import type { FastifyInstance } from "fastify";

export type DirectoryAccount = {
  userId: string;
  token: string;
  email: string;
  task: string;
  doc: string;
  project: string;
};

const day = (days: number, hour = 17) => {
  const d = new Date(Date.now() + days * 86_400_000);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};

/**
 * Makes (or resets) the reviewer account on `app`'s database and gives it
 * demo content. `password` is set as given.
 */
export async function seedDirectoryAccount(
  app: FastifyInstance,
  opts: { email: string; password: string; name?: string },
): Promise<DirectoryAccount> {
  const { pool } = await import("../src/db/pool.js");
  const email = opts.email.trim().toLowerCase();
  const admins = (
    await pool.query("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1")
  ).rowCount;
  if (!admins)
    throw new Error(
      "This database has no admin yet; the reviewer would become one. Make the admin account first.",
    );
  const hash = await argon2.hash(opts.password);
  let user = (
    await pool.query<{ id: string }>("SELECT id FROM users WHERE email = $1", [
      email,
    ])
  ).rows[0];
  if (!user) {
    const r = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email,
        password: opts.password,
        name: opts.name ?? "Directory Reviewer",
      },
    });
    if (r.statusCode >= 300)
      throw new Error(`Signing up failed (${r.statusCode}): ${r.body}`);
    user = { id: (r.json() as { user: { id: string } }).user.id };
  }
  // A plain member: verified, no two-step sign-in, not disabled, and the
  // Terms in force accepted.
  const { settings } = await import("../src/lib/settings.js");
  const { agreementVersion } = await import("@orbyn/core");
  const terms = agreementVersion((await settings()).legal);
  await pool.query(
    `UPDATE users SET password_hash = $2, email_verified = true, role = 'member',
            disabled = false, terms_version = $3, terms_accepted_at = now()
      WHERE id = $1`,
    [user.id, hash, terms],
  );
  await pool.query("DELETE FROM user_totp WHERE user_id = $1", [user.id]);

  const login = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email, password: opts.password },
  });
  if (login.statusCode >= 300)
    throw new Error(`Signing in failed (${login.statusCode}): ${login.body}`);
  const token = (login.json() as { token: string }).token;
  const call = async (
    method: "GET" | "POST",
    url: string,
    payload?: object,
  ) => {
    const r = await app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${token}` },
      ...(payload ? { payload } : {}),
    });
    if (r.statusCode >= 300)
      throw new Error(`${method} ${url} failed (${r.statusCode}): ${r.body}`);
    return r.json();
  };

  // Demo content, once.
  const existing = (
    await pool.query<{ kind: string; id: string }>(
      `(SELECT 'task' AS kind, id FROM items WHERE user_id = $1 AND title = 'Finish the lab report' LIMIT 1)
       UNION ALL (SELECT 'doc', id FROM docs WHERE user_id = $1 AND title = 'Biology notes' AND deleted_at IS NULL LIMIT 1)
       UNION ALL (SELECT 'project', id FROM projects WHERE user_id = $1 AND name = 'Biology coursework' LIMIT 1)`,
      [user.id],
    )
  ).rows;
  const has = (k: string) => existing.find((e) => e.kind === k)?.id;
  const project =
    has("project") ??
    (
      await call("POST", "/projects", {
        name: "Biology coursework",
        summary: "Lab reports and revision for the end-of-term exam.",
        deadline: day(21),
      })
    ).id;
  const task =
    has("task") ??
    (
      await call("POST", "/items", {
        kind: "task",
        title: "Finish the lab report",
        due_at: day(3),
        estimate_minutes: 120,
        project_id: project,
      })
    ).id;
  if (!has("task")) {
    await call("POST", "/items", {
      kind: "task",
      title: "Read chapter 6: photosynthesis",
      due_at: day(1),
      estimate_minutes: 45,
      project_id: project,
    });
    await call("POST", "/items", {
      kind: "task",
      title: "Old draft outline",
      estimate_minutes: 15,
    });
    await call("POST", "/items", {
      kind: "event",
      title: "Biology lecture",
      due_at: day(1, 10),
      end_at: day(1, 11),
    });
  }
  const doc =
    has("doc") ??
    (
      await call("POST", "/docs", {
        title: "Biology notes",
        project_id: project,
        content: [
          { type: "heading", level: 2, text: "Photosynthesis" },
          {
            type: "paragraph",
            text: "Light reactions happen in the thylakoid membranes; the Calvin cycle happens in the stroma.",
          },
          {
            type: "paragraph",
            text: "What does the Calvin cycle make? :: Glucose (G3P)",
          },
        ],
      })
    ).id;
  return { userId: user.id, token, email, task, doc, project };
}

async function main() {
  const email = process.env.DIRECTORY_EMAIL;
  if (!email) {
    process.stderr.write(
      "Set DIRECTORY_EMAIL to the reviewer's address (and DIRECTORY_PASSWORD, or one is made).\n",
    );
    process.exit(2);
  }
  const password =
    process.env.DIRECTORY_PASSWORD || randomBytes(18).toString("base64url");
  const { buildApp } = await import("../src/app.js");
  const { pool } = await import("../src/db/pool.js");
  const app = await buildApp();
  try {
    const made = await seedDirectoryAccount(app, { email, password });
    process.stdout.write(
      [
        `Reviewer account ready: ${made.email}`,
        `Password (shown once; store it with the submission): ${password}`,
        "Two-step sign-in: off. Role: member. Terms: accepted.",
        `Demo: task ${made.task}, page ${made.doc}, project ${made.project}.`,
        "",
      ].join("\n"),
    );
  } finally {
    await app.close();
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
