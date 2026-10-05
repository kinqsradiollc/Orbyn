import "./setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { StudyOverview } from "@orbyn/core";
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { agendaAiStudy, assertAgendaStudySources } =
  await import("../src/modules/docs/agenda-study-sources.js");
const owners: string[] = [];
const teams: string[] = [];
const now = new Date("2026-10-05T09:00:00Z");
const overview: StudyOverview = {
  due_today: 999,
  new_cards: 20,
  reviewed_today: 0,
  streak: 0,
  decks: [],
  exams: [],
};
before(async () => {
  await migrate();
});
after(async () => {
  await pool.query("DELETE FROM teams WHERE id=ANY($1::uuid[])", [teams]);
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [owners]);
  await pool.end();
});
async function person() {
  const id = randomUUID();
  owners.push(id);
  await pool.query(
    "INSERT INTO users(id,email,name,password_hash,email_verified) VALUES($1,$2,'Agenda study','fixture',true)",
    [id, `${id}@fixture.invalid`],
  );
  return id;
}
async function doc(
  owner: string,
  project: string | null = null,
  team: string | null = null,
) {
  return (
    await pool.query(
      "INSERT INTO docs(user_id,project_id,team_id,title) VALUES($1,$2,$3,'Study fixture') RETURNING id,version",
      [owner, project, team],
    )
  ).rows[0] as { id: string; version: number };
}
async function card(
  owner: string,
  deck: string,
  source: string | null = null,
  known = false,
) {
  await pool.query(
    "INSERT INTO study_cards(user_id,doc_id,source_doc_id,card_key,question,answer,reps,due_at,stability) VALUES($1,$2,$3,$4,'Q','A',$5,$6,$7)",
    [owner, deck, source, randomUUID(), known ? 1 : 0, now, known ? 8 : 0],
  );
}
async function excludedProject(owner: string) {
  return (
    await pool.query(
      "INSERT INTO projects(user_id,name,assistant_off) VALUES($1,'Excluded',true) RETURNING id",
      [owner],
    )
  ).rows[0].id as string;
}
async function exam(owner: string, docs: string[]) {
  const key = `own:${randomUUID()}`;
  const id = (
    await pool.query(
      "INSERT INTO study_exams(user_id,exam_key,title,starts_at,own,doc_ids) VALUES($1,$2,'Exam fixture',$3,true,$4) RETURNING id",
      [owner, key, new Date(now.getTime() + 86400000), docs],
    )
  ).rows[0].id as string;
  return {
    id,
    snapshot: {
      key,
      title: "Exam fixture",
      starts_at: new Date(now.getTime() + 86400000).toISOString(),
      all_day: false,
      source: "yours",
      doc_ids: docs,
      readiness: 0.99,
      days_left: 1,
    },
  };
}
test("Study counts exclude hidden decks and hidden original sources while preserving allowed identities", async () => {
  const owner = await person();
  const safe = await doc(owner);
  const original = await doc(owner);
  const hidden = await doc(owner, await excludedProject(owner));
  await card(owner, safe.id, null, true);
  await card(owner, safe.id, original.id);
  await card(owner, safe.id, hidden.id, true);
  await card(owner, hidden.id);
  const result = await agendaAiStudy(owner, overview, now, "UTC");
  assert.deepEqual(result.study, { due: 1, newCards: 1, exams: [] });
  assert.deepEqual(
    new Set(result.sources.map((s) => s.id)),
    new Set([safe.id, original.id]),
  );
  await assertAgendaStudySources(owner, result.sources);
  await pool.query("UPDATE docs SET version=version+1 WHERE id=$1", [
    original.id,
  ]);
  await assert.rejects(
    assertAgendaStudySources(owner, result.sources),
    /source changed/,
  );
});
test("Study exams reject full hidden associations and recompute readiness from permitted cards", async () => {
  const owner = await person();
  const safe = await doc(owner);
  const hidden = await doc(owner, await excludedProject(owner));
  await card(owner, safe.id, null, true);
  await card(owner, safe.id, hidden.id);
  const allowed = await exam(owner, [safe.id]);
  const excluded = await exam(owner, [safe.id, hidden.id]);
  // The ordinary overview may already have dropped a hidden deck; the stored
  // association still prevents disclosure of the exam title.
  const result = await agendaAiStudy(
    owner,
    {
      ...overview,
      exams: [allowed.snapshot, { ...excluded.snapshot, doc_ids: [safe.id] }],
    },
    now,
    "UTC",
  );
  assert.deepEqual(result.study.exams, [
    { title: "Exam fixture", days_left: 1, readiness: 1 },
  ]);
  assert.ok(result.sources.some((s) => s.id === allowed.id));
  assert.ok(!result.sources.some((s) => s.id === excluded.id));
});
test("An exam with an empty captured deck list still rechecks newly excluded team associations", async () => {
  const owner = await person();
  const team = (
    await pool.query(
      "INSERT INTO teams(name,created_by) VALUES('Agenda team',$1) RETURNING id",
      [owner],
    )
  ).rows[0].id;
  teams.push(team);
  await pool.query(
    "INSERT INTO team_members(team_id,user_id,role) VALUES($1,$2,'owner') ON CONFLICT DO NOTHING",
    [team, owner],
  );
  const page = await doc(owner, null, team);
  const own = await exam(owner, [page.id]);
  const result = await agendaAiStudy(
    owner,
    { ...overview, exams: [{ ...own.snapshot, doc_ids: [] }] },
    now,
    "UTC",
  );
  assert.equal(result.study.exams.length, 1);
  await assertAgendaStudySources(owner, result.sources);
  await pool.query("UPDATE teams SET assistant_allowed=false WHERE id=$1", [
    team,
  ]);
  await assert.rejects(
    assertAgendaStudySources(owner, result.sources),
    /source changed/,
  );
  const hidden = await agendaAiStudy(
    owner,
    { ...overview, exams: [{ ...own.snapshot, doc_ids: [] }] },
    now,
    "UTC",
  );
  assert.equal(hidden.study.exams.length, 0);
});
test("Deleted and foreign Study pages cannot contribute facts or remain valid references", async () => {
  const owner = await person();
  const foreign = await person();
  const safe = await doc(owner);
  const other = await doc(foreign);
  await card(owner, safe.id);
  await card(owner, other.id);
  const result = await agendaAiStudy(owner, overview, now, "UTC");
  assert.equal(result.study.newCards, 1);
  assert.deepEqual(
    result.sources.map((s) => s.id),
    [safe.id],
  );
  await assert.rejects(
    assertAgendaStudySources(foreign, result.sources),
    /source changed/,
  );
  await pool.query("UPDATE docs SET deleted_at=now() WHERE id=$1", [safe.id]);
  await assert.rejects(
    assertAgendaStudySources(owner, result.sources),
    /source changed/,
  );
  assert.equal(
    (await agendaAiStudy(owner, overview, now, "UTC")).study.newCards,
    0,
  );
});

test("Team Study cards disappear when AI consent or membership is revoked", async () => {
  const owner = await person();
  const team = (
    await pool.query(
      "INSERT INTO teams(name,created_by) VALUES('Shared study',$1) RETURNING id",
      [owner],
    )
  ).rows[0].id;
  teams.push(team);
  await pool.query(
    "INSERT INTO team_members(team_id,user_id,role) VALUES($1,$2,'owner') ON CONFLICT DO NOTHING",
    [team, owner],
  );
  const page = await doc(owner, null, team);
  await card(owner, page.id, null, true);
  const captured = await agendaAiStudy(owner, overview, now, "UTC");
  assert.equal(captured.study.due, 1);
  await pool.query("UPDATE teams SET assistant_allowed=false WHERE id=$1", [
    team,
  ]);
  await assert.rejects(
    assertAgendaStudySources(owner, captured.sources),
    /source changed/,
  );
  assert.equal((await agendaAiStudy(owner, overview, now, "UTC")).study.due, 0);
  await pool.query("UPDATE teams SET assistant_allowed=true WHERE id=$1", [
    team,
  ]);
  await pool.query("DELETE FROM team_members WHERE team_id=$1 AND user_id=$2", [
    team,
    owner,
  ]);
  await assert.rejects(
    assertAgendaStudySources(owner, captured.sources),
    /source changed/,
  );
  assert.equal((await agendaAiStudy(owner, overview, now, "UTC")).study.due, 0);
});
