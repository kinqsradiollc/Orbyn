/** Synthetic UI fixtures. Refuses every target except the marked local preview DB.
 * Usage: node backend/scripts/seed-ui-demo.mjs --apply --date=2026-10-29
 * Without --apply this only checks readiness. Existing content is never replaced.
 */
import { readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { parse } from "dotenv";
import pg from "pg";
import argon2 from "argon2";
import {
  viewDefinition,
  actionSchema,
  addDays,
  dayTime,
  parseDocContainers,
  parseVersionedDocContent,
} from "@orbyn/core";

const config = parse(readFileSync(new URL("../../.env", import.meta.url)));
const target = new URL(config.DATABASE_URL);
if (
  !["127.0.0.1", "localhost"].includes(target.hostname) ||
  target.port !== "5433" ||
  target.pathname !== "/orbyn"
) {
  throw new Error("UI demo seed is restricted to localhost:5433/orbyn.");
}
const day =
  process.argv.find((x) => x.startsWith("--date="))?.slice(7) ??
  new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne" }).format(
    new Date(),
  );
if (
  !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
  Number.isNaN(Date.parse(day)) ||
  new Date(day).toISOString().slice(0, 10) !== day
)
  throw new Error("Use --date=YYYY-MM-DD.");
const id = (key) => {
  const hex = createHash("sha256")
    .update(`orbyn-ui-demo-v1:${key}`)
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
const at = (offset, hour = 17, minute = 0) =>
  dayTime(
    addDays(day, offset),
    hour * 60 + minute,
    "Australia/Melbourne",
  ).toISOString();
const c = new pg.Client({ connectionString: config.DATABASE_URL });
const counts = {};
async function put(table, row, conflict = "id") {
  const cols = Object.keys(row),
    vals = Object.values(row);
  const result = await c.query(
    `INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map((_, i) => "$" + (i + 1)).join(",")}) ON CONFLICT (${conflict}) DO NOTHING`,
    vals,
  );
  counts[table] = (counts[table] ?? 0) + result.rowCount;
}
try {
  await c.connect();
  const marker = (
    await c.query("select current_setting('orbyn.ui_fixture',true) marker")
  ).rows[0]?.marker;
  if (marker !== "ui-ux-polish")
    throw new Error(
      "Database must be marked orbyn.ui_fixture=ui-ux-polish after verifying its local Docker owner.",
    );
  const admin = (
    await c.query("select id from users where email='admin@example.com'")
  ).rows[0];
  if (!admin) throw new Error("Local admin fixture is missing.");
  if (!process.argv.includes("--apply")) {
    console.log({
      mode: "read-only",
      date: day,
      fixture: "orbyn-ui-demo-v1",
      target: "localhost:5433/orbyn",
      ready: true,
    });
  } else {
    await c.query("BEGIN");
    const owner = admin.id;
    const password = await argon2.hash(randomBytes(32).toString("hex"));
    const people = [
      "Maya Chen",
      "Jordan Lee",
      "Amelia Wilson",
      "Sam Rivera",
      "Linh Nguyen",
      "Noah Patel",
    ];
    for (let n = 0; n < people.length; n++)
      await put("users", {
        id: id(`person-${n}`),
        email: `person-${n}@ui-demo.example`,
        name: people[n],
        password_hash: password,
        email_reminders: false,
        email_verified: true,
        analytics_opt_out: true,
      });
    const teams = [
      "Design studio · Demo",
      "Product & engineering · Demo",
      "Research circle · Demo",
    ];
    for (let n = 0; n < teams.length; n++) {
      await put("teams", {
        id: id(`team-${n}`),
        name: teams[n],
        created_by: owner,
      });
      await put(
        "team_members",
        { team_id: id(`team-${n}`), user_id: owner, role: "owner" },
        "team_id,user_id",
      );
      for (let p = n; p < n + 3; p++)
        await put(
          "team_members",
          {
            team_id: id(`team-${n}`),
            user_id: id(`person-${p % people.length}`),
            role: p === n ? "admin" : "member",
          },
          "team_id,user_id",
        );
    }
    const projectNames = [
      "Spring product launch",
      "Customer discovery",
      "A calmer workspace",
      "Research methods portfolio",
      "Community workshop",
      "Platform reliability",
    ];
    for (let n = 0; n < projectNames.length; n++) {
      await put("projects", {
        id: id(`project-${n}`),
        user_id: owner,
        team_id: n < 3 ? id(`team-${n}`) : null,
        name: projectNames[n],
        summary: [
          "Bring the new planning experience to our early community.",
          "Turn interview insights into clear product decisions.",
          "Make everyday planning feel focused and effortless.",
          "Prepare the research plan, presentation and final submission.",
          "A hands-on session for people building better work habits.",
          "Keep the product fast, dependable and easy to operate.",
        ][n],
        deadline: at(8 + n * 3),
        status: n === 4 ? "paused" : "active",
      });
      for (let s = 0; s < 3; s++)
        await put("project_stages", {
          id: id(`stage-${n}-${s}`),
          project_id: id(`project-${n}`),
          name: ["Explore", "In progress", "Ready to share"][s],
          position: s,
        });
    }
    const listNames = ["This week", "Personal", "Learning", "Ideas to explore"];
    for (let n = 0; n < listNames.length; n++)
      await put("lists", {
        id: id(`list-${n}`),
        user_id: owner,
        name: listNames[n],
        color: ["#2563eb", "#8b5cf6", "#0d9488", "#d97706"][n],
        position: n,
      });
    const tagNames = [
      "Design",
      "Research",
      "Writing",
      "Planning",
      "Important",
      "Small win",
    ];
    for (let n = 0; n < tagNames.length; n++)
      await put("tags", {
        id: id(`tag-${n}`),
        user_id: owner,
        name: tagNames[n],
        color: [
          "#2563eb",
          "#8b5cf6",
          "#0d9488",
          "#d97706",
          "#dc2626",
          "#16a34a",
        ][n],
      });
    // Team-owned items must use lists/tags in that same team scope.
    for (let team = 0; team < 3; team++) {
      for (let n = 0; n < listNames.length; n++)
        await put("lists", {
          id: id(`team-list-${team}-${n}`),
          user_id: owner,
          team_id: id(`team-${team}`),
          name: `${["Studio", "Product", "Research"][team]} · ${listNames[n]}`,
          color: ["#2563eb", "#8b5cf6", "#0d9488", "#d97706"][n],
          position: n,
        });
      for (let n = 0; n < tagNames.length; n++)
        await put("tags", {
          id: id(`team-tag-${team}-${n}`),
          user_id: owner,
          team_id: id(`team-${team}`),
          name: tagNames[n],
          color: [
            "#2563eb",
            "#8b5cf6",
            "#0d9488",
            "#d97706",
            "#dc2626",
            "#16a34a",
          ][n],
        });
    }
    const titles = [
      "Finalize the launch brief",
      "Review the onboarding prototype",
      "Synthesize the customer interviews",
      "Write the weekly project update",
      "Prepare the workshop agenda",
      "Share the accessibility handoff",
      "Map the first-run journey",
      "Review the pricing research",
      "Draft the research presentation",
      "Organize the community feedback",
      "Refine the mobile navigation",
      "Publish the internal release notes",
      "Outline the next usability session",
      "Prepare the design review",
      "Compare the interview themes",
      "Plan next week’s focus blocks",
      "Update the project decisions",
      "Review the experiment results",
      "Sketch the calendar interactions",
      "Write the team retrospective",
      "Confirm the workshop participants",
      "Refine the document library",
      "Review the error recovery flow",
      "Summarize the reading notes",
    ];
    const statuses = [
      "in_progress",
      "todo",
      "todo",
      "blocked",
      "done",
      "todo",
      "done",
      "todo",
    ];
    for (let n = 0; n < 40; n++) {
      const status = statuses[n % statuses.length],
        project = n % 6,
        team = project < 3 ? id(`team-${project}`) : null;
      await put("items", {
        id: id(`task-${n}`),
        user_id: owner,
        team_id: team,
        assignee_id: team && n % 4 === 0 ? id(`person-${project}`) : owner,
        project_id: id(`project-${project}`),
        stage_id: id(
          `stage-${project}-${status === "done" ? 2 : status === "in_progress" ? 1 : 0}`,
        ),
        list_id: id(team ? `team-list-${project}-${n % 4}` : `list-${n % 4}`),
        title: titles[n % titles.length] + (n >= 24 ? " — follow-up" : ""),
        notes: `Synthetic preview fixture. ${["Bring the draft and open questions to the team review.", "Keep the key decisions in the linked project notes.", "Check the long-form content on a narrow screen before sharing."][n % 3]}`,
        status,
        priority: ["high", "medium", "low"][n % 3],
        due_at: at(
          n < 7 ? 0 : n < 10 ? -1 : 1 + (n % 8),
          n % 3 === 0 ? 12 : 17,
        ),
        estimate_minutes: [25, 45, 60, 90][n % 4],
        progress:
          status === "done"
            ? 100
            : status === "in_progress"
              ? 45
              : status === "blocked"
                ? 20
                : 0,
        spent_minutes:
          status === "done" ? 45 : status === "in_progress" ? 20 : 0,
        reminder_minutes: null,
        alerts: [],
        timezone: "Australia/Melbourne",
        position: n,
      });
      await put(
        "item_tags",
        {
          item_id: id(`task-${n}`),
          tag_id: id(team ? `team-tag-${project}-${n % 6}` : `tag-${n % 6}`),
        },
        "item_id,tag_id",
      );
      if (process.argv.includes("--repair")) {
        await c.query(
          "UPDATE items SET list_id=$2,assignee_id=$3,version=version+1 WHERE id=$1 AND user_id=$4 AND (list_id IS DISTINCT FROM $2 OR assignee_id IS DISTINCT FROM $3)",
          [
            id(`task-${n}`),
            id(team ? `team-list-${project}-${n % 4}` : `list-${n % 4}`),
            team && n % 4 === 0 ? id(`person-${project}`) : owner,
            owner,
          ],
        );
        if (team)
          await c.query(
            "DELETE FROM item_tags WHERE item_id=$1 AND tag_id=$2",
            [id(`task-${n}`), id(`tag-${n % 6}`)],
          );
      }
      if (n < 6)
        await put("item_updates", {
          id: id(`update-${n}`),
          item_id: id(`task-${n}`),
          user_id: owner,
          body: "Demo update: first draft is ready. The next review will cover the remaining decisions.",
          status,
          progress: status === "done" ? 100 : 45,
        });
    }
    for (let n = 0; n < 14; n++) {
      const offset = Math.floor(n / 2),
        start = at(offset, n % 2 ? 14 : 10, n % 2 ? 30 : 0);
      await put("items", {
        id: id(`event-${n}`),
        user_id: owner,
        team_id: n % 3 === 0 ? id("team-0") : null,
        title: [
          "Studio standup",
          "Research catch-up",
          "Launch planning",
          "Design critique",
          "Workshop preparation",
          "Weekly reflection",
        ][n % 6],
        notes:
          "Synthetic calendar event for UI preview. No invitations are sent.",
        kind: "event",
        status: "todo",
        priority: "medium",
        due_at: start,
        end_at: new Date(Date.parse(start) + 45 * 60000).toISOString(),
        reminder_minutes: null,
        alerts: [],
        timezone: "Australia/Melbourne",
        location: n % 2 ? "Studio room 2" : "Online",
        color: n % 2 ? "#8b5cf6" : "#2563eb",
      });
    }
    for (let n = 0; n < 9; n++)
      await put("time_blocks", {
        id: id(`block-${n}`),
        item_id: id(`task-${n}`),
        user_id: owner,
        start_at: at(Math.floor(n / 3), [9, 11, 15][n % 3]),
        end_at: at(Math.floor(n / 3), [9, 11, 15][n % 3], 45),
        source: "manual",
      });
    const folderNames = [
      "Projects",
      "Research library",
      "Personal notes",
      "Meetings",
    ];
    for (let n = 0; n < folderNames.length; n++)
      await put("folders", {
        id: id(`folder-${n}`),
        user_id: owner,
        name: folderNames[n],
        position: n,
      });
    for (let team = 0; team < 3; team++)
      for (let n = 0; n < folderNames.length; n++)
        await put("folders", {
          id: id(`team-folder-${team}-${n}`),
          user_id: owner,
          team_id: id(`team-${team}`),
          name: folderNames[n],
          position: n,
        });
    const docNames = [
      "Spring launch · Project brief",
      "Customer research synthesis",
      "Design principles for a calmer workspace",
      "Workshop run of show",
      "Weekly studio notes",
      "Research methods · Study guide",
      "Mobile navigation decisions",
      "A small collection of useful ideas",
      "Long-form reading notes — attention, planning and everyday work",
      "Personal weekly reflection",
      "Launch checklist",
      "Accessibility review notes",
    ];
    for (let n = 0; n < docNames.length; n++) {
      const content = [
        { type: "heading", level: 1, text: docNames[n] },
        {
          type: "paragraph",
          text: "Demo content for the local Orbyn redesign preview. This is synthetic material, not a real customer record.",
        },
        { type: "heading", level: 2, text: "The work ahead" },
        {
          type: "paragraph",
          text: "Make the next action clear. Keep the important context close to the work, and leave room for decisions to change.",
        },
        { type: "bullet", text: "Review the current draft with the team." },
        {
          type: "bullet",
          text: "Capture open questions and the next practical step.",
        },
        { type: "heading", level: 2, text: "Notes and decisions" },
        {
          type: "paragraph",
          text: "A useful workspace supports reading, writing and planning without competing panels. This longer paragraph exercises the document measure, wrapping and rhythm on both wide and narrow screens.",
        },
      ];
      await put("docs", {
        id: id(`doc-${n}`),
        user_id: owner,
        title: docNames[n],
        team_id: n < 3 ? id(`team-${n}`) : null,
        kind: n === 4 ? "meeting" : n % 3 === 1 ? "note" : "doc",
        content: JSON.stringify(content),
        folder_id: id(n < 3 ? `team-folder-${n}-${n % 4}` : `folder-${n % 4}`),
        project_id: n < 6 ? id(`project-${n}`) : null,
        content_format: 1,
      });
      await put(
        "doc_tags",
        {
          doc_id: id(`doc-${n}`),
          tag_id: id(n < 3 ? `team-tag-${n}-${n % 6}` : `tag-${n % 6}`),
        },
        "doc_id,tag_id",
      );
      if (process.argv.includes("--repair") && n < 3) {
        await c.query(
          "UPDATE docs SET team_id=$2,folder_id=$3,version=version+1 WHERE id=$1 AND user_id=$4 AND (team_id IS DISTINCT FROM $2 OR folder_id IS DISTINCT FROM $3)",
          [
            id(`doc-${n}`),
            id(`team-${n}`),
            id(`team-folder-${n}-${n % 4}`),
            owner,
          ],
        );
        await c.query("DELETE FROM doc_tags WHERE doc_id=$1 AND tag_id=$2", [
          id(`doc-${n}`),
          id(`tag-${n % 6}`),
        ]);
      }
      if (n < 4)
        await put("doc_comments", {
          id: id(`comment-${n}`),
          doc_id: id(`doc-${n}`),
          user_id: n < 3 ? id(`person-${n}`) : owner,
          body: "Demo review comment: the direction is clear. Can we add the decision owner and the next review date?",
        });
    }
    const richSource = `# Research notebook

Synthetic material for the local preview.

## Working questions

> Keep the question specific.
> - What changes for the person?
>   - What evidence would change our decision?

- [ ] Review the pilot notes
- [x] Gather the first examples

| Topic | Evidence | Next step |
| --- | --- | --- |
| Planning | Interviews | Prototype |
| Reading | Diary study | Compare notes |

$$\\hat{p}=\\frac{x}{n}$$

## Reading notes

A longer passage tests reading measure and line wrapping. We keep source text, mathematical expressions and table structure available across editor modes.
`;
    const richNodes = parseDocContainers(richSource, { anchors: true });
    parseVersionedDocContent({ format: 2, nodes: richNodes });
    await c.query("SELECT set_config('orbyn.doc_content_writer','2',true)");
    const richProjection = (
      await c.query("SELECT doc_container_projection($1::jsonb) AS blocks", [
        JSON.stringify(richNodes),
      ])
    ).rows[0].blocks;
    await put("docs", {
      id: id("structured-doc"),
      user_id: owner,
      title: "Research notebook · Tables, nested lists and maths",
      kind: "doc",
      content: JSON.stringify(richProjection),
      content_format: 2,
      content_nodes: JSON.stringify(richNodes),
      folder_id: id("folder-1"),
    });
    await put("docs", {
      id: id("unicode-doc"),
      user_id: owner,
      title: "研究ノート · Ghi chú nghiên cứu · ملاحظات البحث",
      kind: "note",
      content: JSON.stringify([
        {
          type: "paragraph",
          text: "Synthetic multilingual preview: a short note with CJK, Vietnamese and Arabic text, plus an unbroken reference preview.identifier.for.a.long.research.collection.example.",
        },
      ]),
      folder_id: id("folder-1"),
    });
    await put("items", {
      id: id("long-task"),
      user_id: owner,
      title:
        "Coordinate the research workshop handoff across product, design and engineering — including the long-form notes and accessibility review",
      notes:
        "Synthetic long-label fixture. Keep the full title reachable in the task detail.",
      kind: "task",
      status: "in_progress",
      priority: "high",
      progress: 35,
      due_at: at(2),
      estimate_minutes: 60,
      reminder_minutes: null,
      alerts: [],
      timezone: "Australia/Melbourne",
    });
    for (let n = 0; n < 4; n++)
      await put("docs", {
        id: id(`memory-${n}`),
        user_id: owner,
        title: [
          "Working hours and focus preferences",
          "How I like project updates",
          "Research interests",
          "Writing and review preferences",
        ][n],
        kind: "memory",
        content: JSON.stringify([
          {
            type: "paragraph",
            text: [
              "Demo memory: mornings are reserved for focused work; meetings work best after lunch.",
              "Demo memory: use a short summary, decisions and next actions for project updates.",
              "Demo memory: human-computer interaction, personal planning and responsible AI.",
              "Demo memory: keep wording direct, preserve the author’s voice and flag uncertainty.",
            ][n],
          },
        ]),
      });
    for (let n = 0; n < 3; n++)
      await put("docs", {
        id: id(`agent-note-${n}`),
        user_id: owner,
        title: [
          "Weekly planning summary",
          "Research reading digest",
          "Launch readiness checklist",
        ][n],
        kind: "agent",
        content: JSON.stringify([
          {
            type: "paragraph",
            text: "Synthetic assistant output for preview. No model was invoked. The draft summarizes the linked demo projects and remains available for human review.",
          },
        ]),
      });
    for (let n = 0; n < 10; n++)
      await put("study_cards", {
        id: id(`study-${n}`),
        user_id: owner,
        doc_id: id("doc-5"),
        card_key: `demo-${n}`,
        question: [
          "What makes a research question useful?",
          "What is the role of a pilot study?",
          "How do qualitative and quantitative evidence differ?",
          "What is a confounding variable?",
          "Why record inclusion criteria?",
        ][n % 5],
        answer: [
          "It is specific, answerable and connected to a meaningful uncertainty.",
          "It checks feasibility and reveals problems before the main study.",
          "They describe different properties and should be interpreted in context.",
          "A factor associated with both the exposure and the observed outcome.",
          "They make the study population and selection process explicit.",
        ][n % 5],
        due_at: at(n < 6 ? -1 : 2),
        reps: n % 3,
        stability: 2,
        difficulty: 4,
      });
    for (const [n, name, source, filters, layout] of [
      [0, "This week", "tasks", {}, "list"],
      [1, "Open tasks", "tasks", { status: "open" }, "board"],
      [2, "Project library", "pages", {}, "gallery"],
      [3, "Team projects", "projects", {}, "table"],
    ]) {
      const definition = viewDefinition.parse({
        source,
        filters,
        layout,
        group_by: source === "tasks" ? "status" : "none",
      });
      await put("saved_views", {
        id: id(`view-${n}`),
        user_id: owner,
        name,
        source,
        definition: JSON.stringify(definition),
      });
    }
    for (let n = 0; n < 2; n++)
      await put("goals", {
        id: id(`goal-${n}`),
        user_id: owner,
        title: [
          "Launch the new planning experience",
          "Build a sustainable research routine",
        ][n],
        target: [
          "Complete the launch checklist and team handoff",
          "Finish four focused reading sessions each week",
        ][n],
        target_date: at(21).slice(0, 10),
        project_id: id(`project-${n}`),
      });
    for (let n = 0; n < 3; n++)
      await put("habits", {
        id: id(`habit-${n}`),
        user_id: owner,
        name: ["Morning reading", "Weekly reflection", "Inbox reset"][n],
        cadence: n === 1 ? 1 : 5,
        period: "week",
        duration_minutes: [25, 30, 15][n],
        days: [1, 2, 3, 4, 5],
        window_start: "08:00",
        window_end: "18:00",
        priority: "medium",
      });
    for (let n = 0; n < 8; n++)
      await put("notifications", {
        id: id(`notice-${n}`),
        user_id: owner,
        item_id: id(`task-${n}`),
        item_version: 1,
        channel: "inapp",
        title: [
          "A review is ready",
          "Your next focus block",
          "Project update",
          "A teammate left a comment",
        ][n % 4],
        body: "Demo notification for the local preview. Open the linked work to see the context.",
        state: "sent",
        read: n > 4,
        kind: "reminder",
        ref: id(`task-${n}`),
      });
    for (let n = 0; n < 3; n++)
      await put("ai_chats", {
        id: id(`chat-${n}`),
        user_id: owner,
        title: [
          "Plan the launch week",
          "Review the research notes",
          "A clearer daily plan",
        ][n],
        pinned: n === 0,
        turns: JSON.stringify([
          {
            role: "user",
            text: "Help me see the next steps in this demo workspace.",
          },
          {
            role: "assistant",
            text: "This is a synthetic conversation for the UI preview.\n\n## A focused next step\nStart with the launch brief, then review the onboarding prototype. Your calendar has a studio standup at 10:00.\n\n- Keep a 45-minute focus block for writing.\n- Bring the open questions to the research catch-up.\n- Review the draft before making changes.",
            outcome: "info",
          },
        ]),
      });
    for (let n = 0; n < 2; n++) {
      const actions = [
        actionSchema.parse({
          operation: "create",
          data: {
            title: [
              "Demo: prepare the next-week planning checklist",
              "Demo: write the project handoff summary",
            ][n],
            notes:
              "Synthetic local suggestion. Approve to create a demo task; no messages or external actions.",
            kind: "task",
            status: "todo",
            priority: "medium",
            due_at: at(4),
            team_id: null,
            list_id: id("list-0"),
            alerts: [],
          },
        }),
      ];
      await put("proposals", {
        id: id(`proposal-${n}`),
        user_id: owner,
        actions: JSON.stringify(actions),
        expires_at: at(7),
        summary: [
          "Demo: review the next-week plan",
          "Demo: clarify the project handoff",
        ][n],
        kind: "idea",
        status: "pending",
        source: "assistant",
        changes: "[]",
      });
      if (process.argv.includes("--repair"))
        await c.query(
          "UPDATE proposals SET actions=$2::jsonb WHERE id=$1 AND user_id=$3 AND status='pending' AND actions='[]'::jsonb",
          [id(`proposal-${n}`), JSON.stringify(actions), owner],
        );
    }
    if (process.argv.includes("--repair")) {
      await c.query(
        "UPDATE saved_views SET name='Open tasks' WHERE id=$1 AND user_id=$2 AND name='In progress'",
        [id("view-1"), owner],
      );
      await c.query(
        "UPDATE doc_comments SET user_id=$2 WHERE id=$1 AND doc_id=$3",
        [id("comment-3"), owner, id("doc-3")],
      );
    }
    for (let n = 0; n < 3; n++) {
      await put("booking_pages", {
        id: id(`booking-page-${n}`),
        owner_id: owner,
        slug: `ui-demo-${n}`,
        title: [
          "Design office hours",
          "Research interview",
          "Project catch-up",
        ][n],
        description:
          "Synthetic booking page for the local UI preview. No real bookings or emails.",
        durations: [30, 45],
        active: true,
        color: ["#2563eb", "#8b5cf6", "#0d9488"][n],
        remind_before_minutes: [],
      });
      await put("bookings", {
        id: id(`booking-${n}`),
        page_id: id(`booking-page-${n}`),
        start_at: at(n + 1, 13),
        end_at: at(n + 1, 13, 30),
        name: people[n],
        email: `guest-${n}@ui-demo.example`,
        note: "Synthetic booking fixture; no invitation or email is sent.",
        status: "confirmed",
        timezone: "Australia/Melbourne",
        assigned_user_id: owner,
      });
    }
    await c.query("COMMIT");
    console.log(
      JSON.stringify(
        { fixture: "orbyn-ui-demo-v1", date: day, inserted: counts },
        null,
        2,
      ),
    );
  }
} catch (error) {
  await c.query("ROLLBACK").catch(() => {});
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
