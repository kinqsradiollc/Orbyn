import { actionSchema } from "@orbyn/core";
/** Imported terminal examples only. No accepted outcomes, workers or effects. */
export async function seedAgentHistory({
  db,
  put,
  id,
  owner,
  taskId,
  projectId,
  at,
  withNight = false,
}) {
  const key = (name) => id(`agent-history:${owner}:${name}`);
  const control = (
    await db.query(
      "SELECT background_paused,overnight_paused FROM agent_settings WHERE user_id=$1",
      [owner],
    )
  ).rows[0];
  const blocked = (lane) =>
    lane === "overnight"
      ? control?.overnight_paused
      : control?.background_paused;
  let nightId = null;
  if (withNight && !blocked("overnight")) {
    nightId = key("night");
    await put("assistant_nights", {
      id: nightId,
      user_id: owner,
      local_day: "2000-01-02",
      status: "done",
      runs: 2,
      budget_used: 0,
      summary: JSON.stringify({
        synthetic: true,
        note: "Demo fixture — no model was run.",
        not_done: [],
      }),
      notified_at: at(-1),
      notice_checked_at: at(-1),
    });
  }
  for (const lane of ["background", "overnight"])
    for (const state of ["done", "failed"]) {
      // Current admission controls also fence terminal imports. Never relax
      // an existing user's controls merely to populate a preview.
      if (blocked(lane)) continue;
      const name = `${lane}-${state}`,
        chat = key(`chat-${name}`),
        job = key(`job-${name}`);
      const title = `Demo fixture — no model was run · ${lane} ${state === "done" ? "summary" : "failure"}`;
      const answer = `Demo fixture — no model was run. ${state === "done" ? "This is an imported sample summary for reviewing source-linked work." : "This is an imported failed-process sample; no provider was contacted."} The outcome is unverified. No effects, accepted goal or execution evidence are claimed.`;
      await put("ai_chats", {
        id: chat,
        user_id: owner,
        project_id: projectId,
        title,
        origin: lane === "overnight" ? "night" : "task",
        scope_kind: "task",
        scope_id: taskId,
        turns: JSON.stringify([
          {
            role: "user",
            text: "Show a synthetic development history example.",
          },
          { role: "assistant", text: answer, outcome: "info" },
        ]),
      });
      const inserted = await put("ai_jobs", {
        id: job,
        user_id: owner,
        chat_id: chat,
        state,
        run_origin: lane === "overnight" ? "night" : "task",
        run_state: JSON.stringify({
          request: {
            automation: {
              kind: lane === "overnight" ? "night" : "task",
              id: taskId,
              source_kind: "task",
            },
          },
        }),
        sources_checked: true,
        work_source_kind: "task",
        work_source_id: taskId,
        result: JSON.stringify({
          answer,
          assistant_run: { token_estimate: 0, synthetic_fixture: true },
        }),
        error_status: state === "failed" ? 503 : null,
        error_message:
          state === "failed"
            ? "Demo fixture — no model was run. Synthetic failure example."
            : null,
      });
      await put(
        "assistant_job_sources",
        { job_id: job, source_kind: "task", source_id: taskId },
        "job_id,source_kind,source_id",
      );
      if (inserted) {
        await db.query(
          "UPDATE ai_jobs SET run_state=NULL WHERE id=$1 AND user_id=$2 AND state IN ('done','failed')",
          [job, owner],
        );
        const sequence = (
          await db.query(
            "INSERT INTO assistant_activity_streams(owner_id,runtime_lane,last_sequence) VALUES($1,$2,1) ON CONFLICT(owner_id,runtime_lane) DO UPDATE SET last_sequence=assistant_activity_streams.last_sequence+1 RETURNING last_sequence",
            [owner, lane],
          )
        ).rows[0].last_sequence;
        await put(
          "assistant_activity_events",
          {
            owner_id: owner,
            runtime_lane: lane,
            sequence,
            job_id: job,
            kind: state,
          },
          "owner_id,runtime_lane,sequence",
        );
      }
      if (nightId && lane === "overnight")
        await put("assistant_night_runs", {
          id: key(`night-run-${state}`),
          night_id: nightId,
          job_id: job,
          kind: "handed",
          summary: answer,
          status: "kept",
        });
    }
  for (let n = 0; n < 2; n++) {
    const action = actionSchema.parse({
      operation: "create",
      data: {
        title: `Demo fixture — private sample task ${n + 1}`,
        notes:
          "Demo fixture — no model was run. Accepting this harmless local suggestion creates one private sample task.",
        kind: "task",
        status: "todo",
        priority: "medium",
        team_id: null,
        alerts: [],
      },
    });
    await put("proposals", {
      id: key(`proposal-${n}`),
      user_id: owner,
      actions: JSON.stringify([action]),
      expires_at: at(7),
      summary: "Demo fixture — no model was run · Review a private sample task",
      kind: "idea",
      status: "pending",
      source: "assistant",
      changes: "[]",
    });
  }
}
