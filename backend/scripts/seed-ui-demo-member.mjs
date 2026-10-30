/** Additive, owner-namespaced examples. Never edits an existing task/page/profile. */
export async function seedMemberCatalog({
  put,
  id,
  owner,
  at,
  day,
  adminTeams,
}) {
  const key = (name) => id(`member:${owner}:${name}`);
  for (const team of adminTeams)
    await put(
      "team_members",
      { team_id: team, user_id: owner, role: "member" },
      "team_id,user_id",
    );
  for (let n = 0; n < 3; n++)
    await put("projects", {
      id: key(`project-${n}`),
      user_id: owner,
      name: [
        "Demo · Product launch",
        "Demo · Reading & research",
        "Demo · Personal planning",
      ][n],
      summary:
        "Synthetic development examples. No AI, external provider or unattended work has executed.",
      status: "active",
      deadline: n === 2 ? null : at(n + 7),
    });
  const states = ["todo", "in_progress", "blocked", "done"];
  for (let n = 0; n < 16; n++) {
    const status = states[n % 4];
    await put("items", {
      id: key(`task-${n}`),
      user_id: owner,
      project_id: key(`project-${n % 3}`),
      title:
        n === 0
          ? "Demo · Overdue handoff — prepare the evidence and the decision before the next research review"
          : n === 1
            ? "Demo · 研究ノート · Ghi chú · ملاحظات"
            : `Demo · ${["Plan next week", "Write source summary", "Waiting for a decision", "Completed reading"][n % 4]} ${n + 1}`,
      notes:
        n === 2
          ? "Synthetic blocked example. Ask the project owner which approach to use; no actual question or worker is waiting."
          : `Synthetic local task ${n + 1}.\n\nUse this record to inspect status, notes, date, priority and navigation. No model was invoked.`,
      kind: "task",
      status,
      priority: ["high", "medium", "low"][n % 3],
      progress: status === "done" ? 100 : status === "in_progress" ? 40 : 0,
      due_at: n === 15 ? null : at(n < 4 ? -2 : 1 + (n % 5)),
      estimate_minutes: [15, 25, 60, 90][n % 4],
      spent_minutes: status === "done" ? 25 : 0,
      reminder_minutes: null,
      alerts: [],
      timezone: "Australia/Melbourne",
    });
  }
  for (let n = 0; n < 4; n++) {
    await put("items", {
      id: key(`event-${n}`),
      user_id: owner,
      project_id: key(`project-${n % 3}`),
      title: `Demo · ${["Design review", "Reading group", "Workshop — accessibility & Unicode", "Focus planning"][n]}`,
      notes:
        "Synthetic event; no attendees, email, reminders or external calendar are configured.",
      kind: "event",
      status: "todo",
      priority: "medium",
      due_at: at(n, 10),
      end_at: at(n, 11),
      timezone: "Australia/Melbourne",
      reminder_minutes: null,
      alerts: [],
    });
    await put("time_blocks", {
      id: key(`time-${n}`),
      user_id: owner,
      item_id: key(`task-${n}`),
      start_at: at(n, 14),
      end_at: at(n, 14, 45),
      source: "manual",
    });
  }
  for (let n = 0; n < 8; n++)
    await put("docs", {
      id: key(`doc-${n}`),
      user_id: owner,
      project_id: n < 6 ? key(`project-${n % 3}`) : null,
      item_id: n === 3 ? key("task-3") : null,
      title: [
        "Demo · Project brief",
        "Demo · Source notes",
        "Demo · Meeting decisions",
        "Demo · Task-linked note",
        "Demo · Long-form research",
        "Demo · Empty page",
        "Demo · Synthetic agent result",
        "Demo · Working preferences",
      ][n],
      kind:
        n === 6 ? "agent" : n === 7 ? "memory" : n === 2 ? "meeting" : "note",
      content: JSON.stringify(
        n === 5
          ? []
          : [
              {
                type: "paragraph",
                text:
                  n === 6
                    ? "SYNTHETIC RESULT · No AI executed. A demonstration summary is ready for human review; this is not a completed goal or verified runtime receipt."
                    : n === 4
                      ? "Synthetic long-form research paragraph. Preserve the authored text and wrap it at narrow widths. ".repeat(
                          70,
                        )
                      : "Synthetic source material for development.\nDecision: compare the alternatives before making changes.\nNext action: review this page with its linked project.",
              },
              {
                type: "paragraph",
                text: "研究 · ghi chú · ملاحظات · café · 👩🏽‍💻",
              },
            ],
      ),
    });
  for (let n = 0; n < 2; n++) {
    await put("goals", {
      id: key(`goal-${n}`),
      user_id: owner,
      title: `Demo · ${n ? "Complete the reading plan" : "Prepare the product review"}`,
      target:
        "Synthetic planning goal; no execution or automatic acceptance has been started.",
      target_date: at(14).slice(0, 10),
      project_id: key(`project-${n}`),
    });
    await put("agent_routines", {
      id: key(`routine-${n}`),
      user_id: owner,
      instruction: `SYNTHETIC · ${n ? "Review the selected source notes" : "Prepare a planning summary"}. Paused example; no AI has executed.`,
      rrule: "FREQ=DAILY",
      timezone: "Australia/Melbourne",
      next_run_at: at(2 + n, 9),
      paused: true,
    });
    await put("habits", {
      id: key(`habit-${n}`),
      user_id: owner,
      name: `Demo · ${n ? "Weekly reflection" : "Morning reading"}`,
      cadence: 3,
      period: "week",
      duration_minutes: 25,
      days: [1, 3, 5],
      window_start: "08:00",
      window_end: "18:00",
      priority: "medium",
    });
  }
  for (let n = 0; n < 3; n++)
    await put("study_cards", {
      id: key(`card-${n}`),
      user_id: owner,
      doc_id: key("doc-1"),
      card_key: `demo-card-${n}`,
      question: [
        "What decision needs evidence?",
        "What does source coverage mean?",
        "What remains outside a quiet check?",
      ][n],
      answer: [
        "Compare alternatives using current source material.",
        "Read every selected source fully and check that it stayed stable.",
        "Child tasks, sessions, linked files and external sources.",
      ][n],
      due_at: at(-1),
      reps: 0,
      stability: 2,
      difficulty: 4,
    });
  for (let n = 0; n < 3; n++)
    await put("ai_chats", {
      id: key(`chat-${n}`),
      user_id: owner,
      project_id: key(`project-${n}`),
      title: `Synthetic · ${["Read-only planning summary", "Interrupted example — review next steps", "Question example — no active run"][n]}`,
      turns: JSON.stringify([
        { role: "user", text: "Show a synthetic development scenario." },
        {
          role: "assistant",
          text: [
            "SYNTHETIC · No AI executed. A sample summary is ready for human review.",
            "SYNTHETIC · No AI executed. This example describes interrupted work and an explicit next action; no job is running.",
            "SYNTHETIC · No AI executed. Which source would you like to review? This is illustrative conversation text, not a live waiting question.",
          ][n],
          outcome: "info",
        },
      ]),
    });
  // Paired source reminders exercise grouping while preserving per-notice actions.
  for (let n = 0; n < 6; n++)
    await put("notifications", {
      id: key(`notice-${n}`),
      user_id: owner,
      item_id: key(`task-${Math.floor(n / 2)}`),
      item_version: 1,
      channel: "inapp",
      title: `Demo · ${n % 2 ? "A follow-up is ready" : "Review the next step"}`,
      body: "Fictional development reminder. Open the linked task to review its context.",
      state: "sent",
      read: n === 1 || n === 4,
      kind: "reminder",
      ref: key(`notice-${n}`),
    });
}
