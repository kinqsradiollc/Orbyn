import "./setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { linkMarkdown } from "@orbyn/core";
const { pool, transaction } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { studyOverview, reviewQueue, quizQueue } =
  await import("../src/modules/study/service.js");
const owners: string[] = [];
before(() => migrate());
after(async () => {
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [owners]);
  await pool.end();
});

for (const kind of ["overview", "review", "quiz"] as const) {
  test(`Study ${kind} resolves links using its supplied transaction's current visibility`, async () => {
    const owner = randomUUID(),
      foreign = randomUUID();
    owners.push(owner, foreign);
    for (const id of [owner, foreign]) {
      await pool.query(
        "INSERT INTO users(id,email,password_hash,name,email_verified) VALUES($1,$2,'fixture','Transaction reader',true)",
        [id, `${id}@fixture.invalid`],
      );
    }
    const deck = (
      await pool.query(
        "INSERT INTO docs(user_id,title) VALUES($1,'Deck') RETURNING id",
        [owner],
      )
    ).rows[0].id;
    const target = (
      await pool.query(
        "INSERT INTO docs(user_id,title) VALUES($1,'Draft reference') RETURNING id",
        [owner],
      )
    ).rows[0].id;
    const question = `Read ${linkMarkdown({ kind: "doc", id: target }, "Draft reference")}`;
    await pool.query(
      "INSERT INTO study_cards(user_id,doc_id,card_key,question,answer,reps,misses,due_at,stability,difficulty) VALUES($1,$2,'fixture',$3,'Answer',1,1,now()-interval '1 hour',1,5)",
      [owner, deck, question],
    );
    const now = new Date();
    await transaction(async (db) => {
      // The transaction sees this revocation; a separate pool connection still sees the old owner.
      await db.query("UPDATE docs SET user_id=$2 WHERE id=$1", [
        target,
        foreign,
      ]);
      const cards =
        kind === "overview"
          ? (await studyOverview(owner, now, db)).weak
          : kind === "review"
            ? await reviewQueue(owner, { limit: 10, ahead: false }, now, db)
            : (await quizQueue(owner, { limit: 10 }, now, db)).cards;
      assert.equal(cards.length, 1);
      assert.match(cards[0].question, /Private page/);
      assert.ok(!cards[0].question.includes("Draft reference"));
    });
  });
}
