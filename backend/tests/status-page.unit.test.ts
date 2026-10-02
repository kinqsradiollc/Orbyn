import { test } from "node:test";
import assert from "node:assert/strict";
import {
  groupStatusComponents,
  groupSummary,
  incidentSeverity,
  incidentUpdates,
  splitIncidents,
  statusSummary,
  worstState,
  type ServiceState,
  type StatusComponent,
  type StatusIncident,
} from "@orbyn/core";

/**
 * The compact status page: components in groups (healthy ones fold), active
 * incidents first, past ones with a severity and their updates. The wording
 * is shared by the web page and the phone's sheet.
 */

const component = (
  id: string,
  state: ServiceState,
  quarter: number | null = 0.999,
): StatusComponent => ({
  id,
  name: id.toUpperCase(),
  description: "",
  state,
  latency_ms: null,
  checked_at: null,
  uptime: { day: quarter, week: quarter, quarter },
  history: [],
});

const incident = (
  name: string,
  started_at: string,
  resolved_at: string | null,
  duration_s: number,
): StatusIncident => ({
  component: name.toLowerCase(),
  name,
  started_at,
  resolved_at,
  duration_s,
});

test("the worst state wins, and no data only when nothing has data", () => {
  assert.equal(worstState(["operational", "degraded", "outage"]), "outage");
  assert.equal(worstState(["operational", "degraded"]), "degraded");
  assert.equal(worstState(["unknown", "operational"]), "operational");
  assert.equal(worstState(["unknown"]), "unknown");
  assert.equal(worstState([]), "unknown");
});

test("components fall into their groups in order, the rest in Other", () => {
  const groups = groupStatusComponents([
    component("database", "operational", 0.9999),
    component("api", "operational", 0.998),
    component("notifier", "outage", 0.97),
    component("converter", "degraded"),
    component("brand-new", "operational"),
  ]);
  assert.deepEqual(
    groups.map((g) => [g.id, g.components.map((c) => c.id), g.state]),
    [
      ["core", ["database", "api"], "operational"],
      ["background", ["notifier", "converter"], "outage"],
      ["other", ["brand-new"], "operational"],
    ],
  );
  // Components keep the report's order. A group's uptime is its weakest
  // part; its problems come worst first.
  assert.equal(groups[0].uptime, 0.998);
  assert.deepEqual(
    groups[1].problems.map((c) => c.id),
    ["notifier", "converter"],
  );
  assert.equal(groupStatusComponents([]).length, 0);
});

test("a group sums itself up in one line", () => {
  assert.equal(
    groupSummary([
      component("a", "operational"),
      component("b", "operational"),
    ]),
    "All 2 operational",
  );
  assert.equal(groupSummary([component("a", "operational")]), "Operational");
  assert.equal(
    groupSummary([component("a", "operational"), component("b", "outage")]),
    "1 of 2 operational",
  );
  assert.equal(groupSummary([component("a", "unknown")]), "No data yet");
  assert.equal(
    groupSummary(
      [component("a", "operational"), component("b", "operational")],
      "components",
    ),
    "All 2 components operational",
  );
});

test("incidents: active first, past newest first, with a severity", () => {
  const list = [
    incident("Old", "2026-09-01T10:00:00Z", "2026-09-01T10:02:00Z", 120),
    incident("Now", "2026-09-26T10:00:00Z", null, 900),
    incident("Newer", "2026-09-20T10:00:00Z", "2026-09-20T12:00:00Z", 7200),
  ];
  const { active, past } = splitIncidents(list);
  assert.deepEqual(
    active.map((i) => i.name),
    ["Now"],
  );
  assert.deepEqual(
    past.map((i) => i.name),
    ["Newer", "Old"],
  );
  assert.equal(incidentSeverity({ duration_s: 59 }), "brief");
  assert.equal(incidentSeverity({ duration_s: 300 }), "minor");
  assert.equal(incidentSeverity({ duration_s: 3599 }), "minor");
  assert.equal(incidentSeverity({ duration_s: 3600 }), "major");
  assert.equal(
    statusSummary([component("a", "operational")], list),
    "Operational · 1 ongoing incident · 2 past incidents in 30 days",
  );
  assert.equal(
    statusSummary([component("a", "operational")], []),
    "Operational · No past incidents in 30 days",
  );
});

test("an incident's updates run newest first", () => {
  const resolved = incidentUpdates(
    incident("Planner", "2026-09-20T10:00:00Z", "2026-09-20T10:30:00Z", 1800),
  );
  assert.deepEqual(
    resolved.map((u) => [u.kind, u.at]),
    [
      ["resolved", "2026-09-20T10:30:00Z"],
      ["started", "2026-09-20T10:00:00Z"],
    ],
  );
  const ongoing = incidentUpdates(
    incident("Planner", "2026-09-26T10:00:00Z", null, 60),
  );
  assert.deepEqual(
    ongoing.map((u) => [u.kind, u.at]),
    [
      ["ongoing", null],
      ["started", "2026-09-26T10:00:00Z"],
    ],
  );
});

test("background and overnight availability remain individually visible in the shared agent group", () => {
  const groups = groupStatusComponents([
    component("ai", "operational"),
    component("assistant-background", "operational"),
    component("assistant-overnight", "outage"),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].id, "ai");
  assert.deepEqual(
    groups[0].problems.map((c) => c.id),
    ["assistant-overnight"],
  );
  assert.equal(groups[0].components.length, 3);
});
