/**
 * Fits the week model to its stage by where the floor and its hour labels
 * really land on screen, not by a width estimate. The stage clips at its edge,
 * so a label that projects past it loses its leading digit.
 */

/** The stage's `perspective`, in pixels. */
const PERSPECTIVE = 1500;

/** How far left of the floor an hour label reaches: its box starts here. */
export const LABEL_REACH = 64;

/**
 * How far an hour label's box reaches past its line, along the depth: half
 * its height, plus the most an end label moves out to clear its neighbour.
 */
export const LABEL_SPREAD = 38;

/**
 * The largest camera scale at which the floor and the hour labels left of it
 * stay inside the stage width less `margin` each side.
 *
 * The camera is `translate(shift) scale(s) rotateX(tilt) rotateZ(yaw)` at the
 * stage centre, with the floor centred on it. CSS `scale(s)` leaves depth
 * alone, so a point's distance toward the viewer comes from the turn alone and
 * its sideways place is `(shift + s * x) * PERSPECTIVE / (PERSPECTIVE - depth)`,
 * which is what this solves for `s` against each edge.
 */
export function fitWidth(input: {
  stageWidth: number;
  world: number;
  depth: number;
  tilt: number;
  yaw: number;
  shift: number;
  margin: number;
  low: number;
  high: number;
}): number {
  const { stageWidth, world, depth, tilt, yaw, shift, margin, low, high } =
    input;
  const yawRad = (yaw * Math.PI) / 180;
  const tiltRad = (tilt * Math.PI) / 180;
  const half = stageWidth / 2 - margin;
  let fit = high;
  for (const x of [-LABEL_REACH, world]) {
    for (const y of [-LABEL_SPREAD, depth + LABEL_SPREAD]) {
      const left = x - world / 2;
      const down = y - depth / 2;
      const across = left * Math.cos(yawRad) - down * Math.sin(yawRad);
      const along = left * Math.sin(yawRad) + down * Math.cos(yawRad);
      const gap = PERSPECTIVE - along * Math.sin(tiltRad);
      if (gap <= 1) return low;
      const room = (half * gap) / PERSPECTIVE;
      // shift + s * across stays within [-room, room].
      const limit =
        across > 0 ? (room - shift) / across : (-room - shift) / across;
      if (across !== 0 && limit < fit) fit = limit;
    }
  }
  return Math.max(low, fit);
}

/** The stage's vanishing point sits this far down it. */
const VANISH = 0.35;

/** How far a day sign stands above the floor's far edge. */
export const SIGN_RISE = 74;

/**
 * The largest camera scale at which every point stays inside the stage, for a
 * camera `translateY(lift) scale(s) rotateX(tilt) rotateZ(yaw)` at the stage
 * centre. Points are `[x, y, z]` from the camera, z up from the floor. Scale
 * leaves depth alone, so each edge is linear in `s`. Used by the close-up,
 * which must keep its labels and signs on the stage.
 */
export function fitBox(input: {
  stageWidth: number;
  stageHeight: number;
  points: readonly (readonly [number, number, number])[];
  tilt: number;
  yaw: number;
  lift: number;
  margin: number;
  low: number;
  high: number;
}): number {
  const { stageWidth, stageHeight, points, tilt, yaw, lift, margin } = input;
  const yawRad = (yaw * Math.PI) / 180;
  const tiltRad = (tilt * Math.PI) / 180;
  const origin = stageHeight * VANISH;
  let fit = input.high;
  for (const [x, y, z] of points) {
    const across = x * Math.cos(yawRad) - y * Math.sin(yawRad);
    const along = x * Math.sin(yawRad) + y * Math.cos(yawRad);
    const down = along * Math.cos(tiltRad) - z * Math.sin(tiltRad);
    const gap =
      PERSPECTIVE - (along * Math.sin(tiltRad) + z * Math.cos(tiltRad));
    if (gap <= 1) return input.low;
    const f = PERSPECTIVE / gap;
    // screen y = base + s * rate, screen x = centre + s * sideways.
    const base = origin + (stageHeight / 2 - origin + lift) * f;
    const rate = down * f;
    const sideways = across * f;
    if (rate > 0) fit = Math.min(fit, (stageHeight - margin - base) / rate);
    else if (rate < 0) fit = Math.min(fit, (base - margin) / -rate);
    const half = stageWidth / 2 - margin;
    if (sideways !== 0) fit = Math.min(fit, half / Math.abs(sideways));
  }
  return Math.max(input.low, fit);
}

type Point = readonly [number, number, number];

/** Screen rows, from the stage top, that the points cover at scale `s`. */
function rowsAt(
  points: readonly Point[],
  s: number,
  tilt: number,
  yaw: number,
  lift: number,
  stageHeight: number,
): [number, number] {
  const yawRad = (yaw * Math.PI) / 180;
  const tiltRad = (tilt * Math.PI) / 180;
  const origin = stageHeight * VANISH;
  let top = Infinity;
  let bottom = -Infinity;
  for (const [x, y, z] of points) {
    const along = x * Math.sin(yawRad) + y * Math.cos(yawRad);
    const down = along * Math.cos(tiltRad) - z * Math.sin(tiltRad);
    const gap =
      PERSPECTIVE - (along * Math.sin(tiltRad) + z * Math.cos(tiltRad));
    const row =
      origin +
      ((stageHeight / 2 - origin + lift + s * down) * PERSPECTIVE) /
        Math.max(1, gap);
    top = Math.min(top, row);
    bottom = Math.max(bottom, row);
  }
  return [top, bottom];
}

/**
 * Fits the model into the band `[top, bottom]` of the stage, rows clear of the
 * controls above and the legend below, and centres it there. Returns the
 * largest scale up to `limit` that fits the band, and the lift that centres it.
 */
export function fitRows(input: {
  stageHeight: number;
  points: readonly Point[];
  tilt: number;
  yaw: number;
  top: number;
  bottom: number;
  limit: number;
}): { scale: number; lift: number } {
  const { stageHeight, points, tilt, yaw, top, bottom, limit } = input;
  const height = (s: number) => {
    const [a, b] = rowsAt(points, s, tilt, yaw, 0, stageHeight);
    return b - a;
  };
  let scale = limit;
  if (height(limit) > bottom - top) {
    let low = 0.1;
    let high = limit;
    for (let i = 0; i < 24; i++) {
      const mid = (low + high) / 2;
      if (height(mid) <= bottom - top) low = mid;
      else high = mid;
    }
    scale = low;
  }
  let lift = 0;
  for (let i = 0; i < 4; i++) {
    const [a, b] = rowsAt(points, scale, tilt, yaw, lift, stageHeight);
    lift += (top + bottom) / 2 - (a + b) / 2;
  }
  return { scale, lift };
}
