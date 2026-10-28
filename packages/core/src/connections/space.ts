import type { ConnectionMap } from "./connections.js";

export type SpaceView = { yaw: number; pitch: number; zoom: number };
export const INITIAL_SPACE_VIEW: SpaceView = {
  yaw: -0.35,
  pitch: 0.2,
  zoom: 1,
};
export function boundedView(view: SpaceView): SpaceView {
  return {
    yaw: view.yaw % (Math.PI * 2),
    pitch: Math.max(-1.35, Math.min(1.35, view.pitch)),
    zoom: Math.max(0.65, Math.min(2.2, view.zoom)),
  };
}

/** Stable sphere positions, rotated in three dimensions before perspective projection.
 * No idle render loop or external renderer; the visible scene changes on input only.
 */
export function projectSpace(map: ConnectionMap, view: SpaceView) {
  const v = boundedView(view);
  const neighbours = map.nodes.filter((n) => n.depth > 0);
  const points = new Map<string, { x: number; y: number; z: number }>();
  neighbours.forEach((node, i) => {
    const y = 1 - (2 * (i + 0.5)) / neighbours.length;
    const ring = Math.sqrt(1 - y * y);
    const angle = i * Math.PI * (3 - Math.sqrt(5));
    const radius = node.depth === 1 ? 125 : 160;
    points.set(node.key, {
      x: Math.cos(angle) * ring * radius,
      y: y * radius,
      z: Math.sin(angle) * ring * radius,
    });
  });
  return map.nodes
    .map((node) => {
      const p = points.get(node.key) ?? { x: 0, y: 0, z: 0 };
      const x = p.x * Math.cos(v.yaw) + p.z * Math.sin(v.yaw);
      const z0 = -p.x * Math.sin(v.yaw) + p.z * Math.cos(v.yaw);
      const y = p.y * Math.cos(v.pitch) - z0 * Math.sin(v.pitch);
      const z = p.y * Math.sin(v.pitch) + z0 * Math.cos(v.pitch);
      const perspective = 420 / (420 - z);
      return {
        ...node,
        x: 320 + x * perspective * v.zoom,
        y: 200 + y * perspective * v.zoom,
        z,
        scale: perspective,
      };
    })
    .sort((a, b) => a.z - b.z);
}

/** A few non-overlapping labels; full names stay available in selection and the list. */
export function spaceLabels(
  nodes: ReturnType<typeof projectSpace>,
  selected: string,
) {
  const occupied: { x: number; y: number }[] = [];
  const labels = new Map<string, { x: number; y: number }>();
  const ordered = [...nodes].sort(
    (a, b) =>
      Number(b.key === selected) - Number(a.key === selected) || b.z - a.z,
  );
  for (const node of ordered) {
    if (labels.size >= 6) break;
    const x = Math.max(64, Math.min(576, node.x));
    for (const y of [node.y + 30, node.y - 24]) {
      if (y < 24 || y > 380) continue;
      if (
        occupied.some((p) => Math.abs(p.x - x) < 128 && Math.abs(p.y - y) < 24)
      )
        continue;
      if (
        nodes.some(
          (n) =>
            n.key !== node.key &&
            Math.abs(n.x - x) < 66 &&
            Math.abs(n.y - y) < 20,
        )
      )
        continue;
      labels.set(node.key, { x, y });
      occupied.push({ x, y });
      break;
    }
  }
  return labels;
}
