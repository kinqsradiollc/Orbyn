import { test } from "node:test";
import assert from "node:assert/strict";
import { parseProjectDraft } from "../src/modules/ai/project-draft.js";

const task = (id: string, depends_on: string[] = []) => ({
  id,
  title: `Task ${id}`,
  notes: "",
  estimate_minutes: 30,
  due_in_days: 2,
  depends_on,
});
const parse = (tasks: unknown[]) =>
  parseProjectDraft(JSON.stringify({ title: "Launch", tasks }));

test("orders prerequisite tasks before their dependents, preserving independent order", () => {
  const result = parse([
    task("ship", ["build", "review"]),
    task("build", ["design"]),
    task("review"),
    task("design"),
  ]);
  assert.deepEqual(
    result.tasks.map((t) => t.id),
    ["review", "design", "build", "ship"],
  );
  assert.deepEqual(result.tasks.at(-1)?.depends_on, ["build", "review"]);
});

test("accepts provider reasoning and code fences without losing estimates or notes", () => {
  const result = parseProjectDraft(
    "<think>Consider dependencies</think>\n```json\n" +
      JSON.stringify({ title: "Launch", tasks: [task("design")] }) +
      "\n```",
  );
  assert.equal(result.tasks[0].estimate_minutes, 30);
});

test("rejects cycles, unknown references, duplicate ids, duplicate dependencies and self references", () => {
  for (const tasks of [
    [task("a", ["b"]), task("b", ["a"])],
    [task("a", ["missing"])],
    [task("a"), task("a")],
    [task("a"), task("b", ["a", "a"])],
    [task("a", ["a"])],
  ])
    assert.throws(() => parse(tasks));
});

test("rejects incomplete or malformed tasks instead of silently dropping dependencies", () => {
  for (const bad of [
    null,
    {},
    { ...task("a"), title: " " },
    { ...task("a"), estimate_minutes: 0 },
    { ...task("a"), estimate_minutes: 30.5 },
    { ...task("a"), estimate_minutes: "30" },
    { ...task("a"), due_in_days: -1 },
    { ...task("a"), due_in_days: Infinity },
  ])
    assert.throws(() => parse([bad]));
  assert.throws(() => parse([]));
  assert.throws(() =>
    parse(Array.from({ length: 16 }, (_, i) => task(`t${i}`))),
  );
});

test("a provider that returns a plain list of tasks still yields a valid project", () => {
  // Ids exist to carry dependencies. A model that emits none has described a
  // project with no edges, and 502-ing that would break the flow on exactly
  // the smaller models this has to run on — which is what happened when the
  // strict graph schema first landed.
  const draft = parseProjectDraft(
    JSON.stringify({
      title: "Launch the newsletter",
      tasks: [
        {
          title: "Pick a platform",
          notes: "",
          estimate_minutes: 60,
          due_in_days: 1,
        },
        {
          title: "Write the first issue",
          notes: "300 words",
          estimate_minutes: 120,
          due_in_days: 3,
        },
        {
          title: "Invite subscribers",
          notes: "",
          estimate_minutes: 45,
          due_in_days: 5,
        },
      ],
    }),
  );
  assert.equal(draft.tasks.length, 3);
  assert.deepEqual(
    draft.tasks.map((t) => t.title),
    ["Pick a platform", "Write the first issue", "Invite subscribers"],
    "order is preserved when nothing depends on anything",
  );
  assert.equal(new Set(draft.tasks.map((t) => t.id)).size, 3, "ids are unique");
  for (const task of draft.tasks) assert.deepEqual(task.depends_on, []);
});

test("synthesised ids never collide with the ones a provider did supply", () => {
  const draft = parseProjectDraft(
    JSON.stringify({
      title: "Half named",
      tasks: [
        {
          id: "t1",
          title: "named",
          notes: "",
          estimate_minutes: 30,
          due_in_days: 0,
          depends_on: [],
        },
        { title: "unnamed", notes: "", estimate_minutes: 30, due_in_days: 0 },
        {
          id: "t2",
          title: "also named",
          notes: "",
          estimate_minutes: 30,
          due_in_days: 0,
          depends_on: ["t1"],
        },
      ],
    }),
  );
  assert.equal(new Set(draft.tasks.map((t) => t.id)).size, 3);
  const made = draft.tasks.find((t) => t.title === "unnamed")!.id;
  assert.ok(
    made !== "t1" && made !== "t2",
    `"${made}" collides with a provider id`,
  );
  // The supplied edge survives the renaming.
  assert.deepEqual(
    draft.tasks.find((t) => t.title === "also named")!.depends_on,
    ["t1"],
  );
});
