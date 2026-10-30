/** Synthetic development catalog. Dry-run by default; --apply requires an
 * independently marked loopback development database. Never resets existing data.
 * See seed-ui-demo-support.mjs for fixed public local-only accounts and guards.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  FIXTURE,
  DEMO_PASSWORD,
  DEMO_ACCOUNTS,
  SCENARIOS,
  fixtureId,
  seedOptions,
  seedTarget,
  assertSeedDatabase,
  assertAccountOwnership,
} from "./seed-ui-demo-support.mjs";
import { parse } from "dotenv";
import pg from "pg";
import { seedMemberCatalog } from "./seed-ui-demo-member.mjs";
import { seedAgentHistory } from "./seed-ui-demo-agent-history.mjs";
import argon2 from "argon2";
import {
  viewDefinition,
  actionSchema,
  addDays,
  dayTime,
  parseDocContainers,
  parseVersionedDocContent,
} from "@orbyn/core";

const options = seedOptions(
  process.argv.slice(2),
  fileURLToPath(new URL("../../", import.meta.url)),
);
const config = parse(readFileSync(options.envFile));
const target = seedTarget(config.DATABASE_URL, options);
if ([config.NODE_ENV, process.env.NODE_ENV].includes("production"))
  throw new Error("Refusing a production process/environment file.");
const day =
  options.date ??
  new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne" }).format(
    new Date(),
  );
if (
  !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
  Number.isNaN(Date.parse(day)) ||
  new Date(day).toISOString().slice(0, 10) !== day
)
  throw new Error("Use --date=YYYY-MM-DD.");
const id = fixtureId;
const at = (offset, hour = 17, minute = 0) =>
  dayTime(
    addDays(day, offset),
    hour * 60 + minute,
    "Australia/Melbourne",
  ).toISOString();
const c = new pg.Client({
  connectionString: target.connectionString,
  options: "",
  application_name: "orbyn-ui-demo-seed",
  connectionTimeoutMillis: 10000,
});
const counts = {};
async function put(table, row, conflict = "id") {
  const cols = Object.keys(row),
    keys = conflict.split(",");
  if (![table, ...cols, ...keys].every((value) => /^[a-z_]+$/.test(value)))
    throw new Error("Invalid seed SQL identifier.");
  const read = async () =>
    (
      await c.query(
        `SELECT * FROM ${table} WHERE ${keys.map((key, i) => `${key}=$${i + 1}`).join(" AND ")}`,
        keys.map((key) => row[key]),
      )
    ).rows[0];
  const preserve = (existing) => {
    if (
      !existing ||
      ["user_id", "owner_id", "created_by"].some(
        (key) => row[key] !== undefined && existing[key] !== row[key],
      )
    )
      throw new Error(
        `Fixture identity collision in ${table}; existing content was preserved.`,
      );
    counts[table] ??= 0;
    return false;
  };
  const existing = await read();
  if (existing) return preserve(existing);
  const result = await c.query(
    `INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map((_, i) => "$" + (i + 1)).join(",")}) ON CONFLICT (${conflict}) DO NOTHING`,
    Object.values(row),
  );
  counts[table] = (counts[table] ?? 0) + result.rowCount;
  return result.rowCount > 0 ? true : preserve(await read());
}

try {
  await c.connect();
  const guard = (
    await c.query(`SELECT current_database() AS database,
    (SELECT substring(setting FROM length('orbyn.ui_fixture=')+1) FROM pg_db_role_setting r CROSS JOIN LATERAL unnest(r.setconfig) setting WHERE r.setdatabase=(SELECT oid FROM pg_database WHERE datname=current_database()) AND r.setrole=0 AND setting LIKE 'orbyn.ui_fixture=%') AS marker,
    current_setting('orbyn.environment',true) AS environment`)
  ).rows[0];
  assertSeedDatabase(guard, target.database);
  await c.query(options.apply ? "BEGIN" : "BEGIN READ ONLY");
  if (options.apply)
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [FIXTURE]);
  const existingAccounts = (
    await c.query(
      "SELECT id,email,role FROM users WHERE id=ANY($1::uuid[]) OR lower(email)=ANY($2::text[])",
      [
        DEMO_ACCOUNTS.map((account) => account.id),
        DEMO_ACCOUNTS.map((account) => account.email.toLowerCase()),
      ],
    )
  ).rows;
  assertAccountOwnership(DEMO_ACCOUNTS, existingAccounts);
  let existingMember = null;
  if (options.existingMemberId) {
    existingMember = (
      await c.query(
        "SELECT id,email,role FROM users WHERE id=$1 AND lower(email)='demo@orbyn.local'",
        [options.existingMemberId],
      )
    ).rows[0];
    if (!existingMember || existingMember.role !== "member")
      throw new Error(
        "The verified existing demo member does not match its ID, email and member role.",
      );
  }
  if (!options.apply) {
    console.log(
      JSON.stringify(
        {
          mode: "dry-run",
          date: day,
          fixture: FIXTURE,
          target: target.display,
          ready: true,
          accounts: DEMO_ACCOUNTS.map(({ email, role, onboarding }) => ({
            email,
            role,
            onboarding,
          })),
          existing_member: existingMember?.email ?? null,
          scenarios: SCENARIOS,
        },
        null,
        2,
      ),
    );
    await c.query("ROLLBACK");
  } else {
    const password = await argon2.hash(DEMO_PASSWORD);
    for (const account of DEMO_ACCOUNTS) {
      await put("users", {
        id: account.id,
        email: account.email,
        name: account.name,
        role: account.role,
        password_hash: password,
        email_reminders: false,
        email_verified: true,
        analytics_opt_out: true,
        first_run_at: account.onboarding ? null : new Date().toISOString(),
      });
    }
    const owner = DEMO_ACCOUNTS.find((account) => account.key === "admin").id;
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
        email: `v2-person-${n}@ui-demo.example`,
        name: people[n],
        password_hash: password,
        email_reminders: false,
        email_verified: true,
        analytics_opt_out: true,
        first_run_at: new Date().toISOString(),
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
    }

    for (let n = 0; n < 3; n++) {
      await put("booking_pages", {
        id: id(`booking-page-${n}`),
        owner_id: owner,
        slug: `orbyn-demo-v2-${n}`,
        title: [
          "Design office hours",
          "Research interview",
          "Project catch-up",
        ][n],
        description:
          "Synthetic booking page for the local UI preview. No real bookings or emails.",
        durations: [30, 45],
        active: false,
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
    await seedAgentHistory({
      db: c,
      put,
      id,
      owner,
      taskId: id("task-0"),
      projectId: id("project-0"),
      at,
      withNight: true,
    });
    for (const member of [
      DEMO_ACCOUNTS.find((account) => account.key === "member"),
      ...(existingMember ? [existingMember] : []),
    ]) {
      await seedMemberCatalog({
        put,
        id,
        owner: member.id,
        at,
        day,
        adminTeams: teams.map((_, n) => id(`team-${n}`)),
      });
      await seedAgentHistory({
        db: c,
        put,
        id,
        owner: member.id,
        taskId: id(`member:${member.id}:task-0`),
        projectId: id(`member:${member.id}:project-0`),
        at,
        withNight: member.id !== existingMember?.id,
      });
    }
    // These newly owned accounts commit paused. No execution grants or live
    // jobs exist at any point; imported terminal history was never admitted.
    for (const account of DEMO_ACCOUNTS)
      await put(
        "agent_settings",
        {
          user_id: account.id,
          background_paused: true,
          overnight_paused: true,
        },
        "user_id",
      );
    await c.query("COMMIT");
    console.log(
      JSON.stringify(
        {
          fixture: FIXTURE,
          date: day,
          inserted: counts,
          accounts: DEMO_ACCOUNTS.map(({ email, role }) => ({ email, role })),
          password: DEMO_PASSWORD,
          scenarios: SCENARIOS,
        },
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
