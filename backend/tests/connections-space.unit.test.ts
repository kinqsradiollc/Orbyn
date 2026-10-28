import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  projectSpace,
  spaceLabels,
  boundedView,
  INITIAL_SPACE_VIEW,
} from "../../packages/core/src/connections/space.js";
import type { ConnectionMap } from "@orbyn/core";
const map: ConnectionMap = {
  nodes: Array.from({ length: 33 }, (_, i) => ({
    key: `task:${i}`,
    id: String(i),
    title: `Connection ${i}`,
    kind: "task" as const,
    depth: (i === 0 ? 0 : i % 2 ? 1 : 2) as 0 | 1 | 2,
  })),
  edges: [],
  truncated: false,
};
test("3D projection keeps every API-owned node, with a stable centre and finite depth", () => {
  const points = projectSpace(map, INITIAL_SPACE_VIEW);
  assert.equal(points.length, map.nodes.length);
  assert.equal(new Set(points.map((n) => n.key)).size, map.nodes.length);
  const centre = points.find((n) => n.depth === 0)!;
  assert.deepEqual([centre.x, centre.y, centre.z], [320, 200, 0]);
  assert.ok(
    points.every((n) => [n.x, n.y, n.z, n.scale].every(Number.isFinite)),
  );
  assert.ok(points.every((n, i) => i === 0 || n.z >= points[i - 1].z));
});
test("orbit changes projected coordinates and depth without changing identities", () => {
  const before = projectSpace(map, INITIAL_SPACE_VIEW);
  const after = projectSpace(map, {
    ...INITIAL_SPACE_VIEW,
    yaw: 1.1,
    pitch: -0.6,
  });
  assert.deepEqual(
    before.map((n) => n.key).sort(),
    after.map((n) => n.key).sort(),
  );
  const a = before.find((n) => n.depth > 0)!;
  const b = after.find((n) => n.key === a.key)!;
  assert.notEqual(a.x, b.x);
  assert.notEqual(a.z, b.z);
});
test("zoom is bounded and reset is deterministic", () => {
  assert.equal(boundedView({ yaw: 0, pitch: 100, zoom: 100 }).zoom, 2.2);
  assert.equal(boundedView({ yaw: 0, pitch: -100, zoom: 0 }).zoom, 0.65);
  assert.equal(boundedView({ yaw: 0, pitch: -100, zoom: 1 }).pitch, -1.35);
  assert.deepEqual(
    projectSpace(map, INITIAL_SPACE_VIEW),
    projectSpace(map, { ...INITIAL_SPACE_VIEW }),
  );
});
test("visible labels are bounded, separated and leave node hit positions intact", () => {
  const points = projectSpace(map, INITIAL_SPACE_VIEW),
    labels = [...spaceLabels(points, "task:0").values()];
  assert.ok(labels.length <= 6);
  for (let i = 0; i < labels.length; i++) {
    const a = labels[i];
    assert.ok(a.x >= 64 && a.x <= 576 && a.y >= 24 && a.y <= 380);
    for (const b of labels.slice(i + 1))
      assert.ok(Math.abs(a.x - b.x) >= 128 || Math.abs(a.y - b.y) >= 24);
  }
});
test("empty and single-node maps render without division artefacts", () => {
  assert.deepEqual(projectSpace({ ...map, nodes: [] }, INITIAL_SPACE_VIEW), []);
  assert.equal(
    projectSpace(
      { ...map, nodes: map.nodes.slice(0, 1) },
      INITIAL_SPACE_VIEW,
    )[0].scale,
    1,
  );
});
test("shared search, project grouping and Activity keep their owning layout contracts", () => {
  const source = (p: string) =>
    readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
  assert.match(
    source("desktop/src/styles/legacy-dark.css"),
    /:root\[data-theme="dark"\] \.search input\s*\{\s*background: transparent;/,
  );
  assert.match(
    source("desktop/src/features/projects/ProjectDetail.tsx"),
    /project-home-main/,
  );
  assert.match(
    source("desktop/src/features/projects/ProjectDetail.tsx"),
    /project-home-aside/,
  );
  assert.doesNotMatch(
    source("desktop/src/features/activity/ActivityDialog.tsx"),
    /<SettingsEditor wide/,
  );
  assert.match(
    source("mobile/src/features/documents/editor/ConnectionsMap.tsx"),
    /projectSpace\(map, view\)/,
  );
  assert.match(
    source("desktop/src/features/connections/ConnectionsMap.tsx"),
    /projectSpace\(map, view\)/,
  );
});
