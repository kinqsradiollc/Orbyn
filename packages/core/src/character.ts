import { z } from "zod";

export const CHARACTER_BODIES = ["orb", "pebble", "spark"] as const;
export const CHARACTER_PALETTES = ["fern", "sage", "ink"] as const;
export const CHARACTER_EYES = ["round", "soft", "bright"] as const;
export const CHARACTER_RINGS = ["orbit", "halo", "none"] as const;
export const CHARACTER_ACCESSORIES = [
  "none",
  "glasses",
  "headphones",
  "cap",
] as const;
export const CHARACTER_PRESENCE = ["animated", "static", "hidden"] as const;

/** Curated parts keep every combination compatible with the same character. */
export const characterAppearanceInput = z
  .object({
    body: z.enum(CHARACTER_BODIES).default("orb"),
    palette: z.enum(CHARACTER_PALETTES).default("fern"),
    eyes: z.enum(CHARACTER_EYES).default("round"),
    ring: z.enum(CHARACTER_RINGS).default("orbit"),
    accessory: z.enum(CHARACTER_ACCESSORIES).default("none"),
    presence: z.enum(CHARACTER_PRESENCE).default("animated"),
  })
  .strict();
export type CharacterAppearance = z.output<typeof characterAppearanceInput>;
export const DEFAULT_CHARACTER: Readonly<CharacterAppearance> = Object.freeze(
  characterAppearanceInput.parse({}),
);
export const CHARACTER_LABELS: Record<string, string> = {
  orb: "Orb",
  pebble: "Pebble",
  spark: "Spark",
  fern: "Fern",
  sage: "Sage",
  ink: "Ink",
  round: "Round",
  soft: "Soft",
  bright: "Bright",
  orbit: "Orbit",
  halo: "Halo",
  none: "None",
  glasses: "Glasses",
  headphones: "Headphones",
  cap: "Cap",
  animated: "Animated",
  static: "Static",
  hidden: "Hidden",
};
export const CHARACTER_PERSONAS = [
  {
    label: "Warm",
    persona:
      "Warm, encouraging, and concise. Help me find a manageable next step.",
  },
  {
    label: "Direct",
    persona:
      "Direct, practical, and concise. Lead with the answer and clear next steps.",
  },
  {
    label: "Playful",
    persona:
      "Friendly, lightly playful, and concise. Keep advice practical and use humour sparingly.",
  },
] as const;

/** Old clients and old records get the same appearance as a new account. */
export function characterAppearance(value: unknown): CharacterAppearance {
  const parsed = characterAppearanceInput.safeParse(value);
  return parsed.success ? parsed.data : { ...DEFAULT_CHARACTER };
}

export type CharacterState =
  "ready" | "working" | "waiting" | "done" | "error" | "interrupted";
export const CHARACTER_STATE_LABELS: Record<CharacterState, string> = {
  ready: "Ready to help",
  working: "Working",
  waiting: "Needs your decision",
  done: "Finished",
  error: "Something went wrong",
  interrupted: "Stopped",
};

/** Decisions take precedence over animation, and errors never look like success. */
export function characterState(input: {
  thinking: boolean;
  runState?: "running" | "waiting" | "done";
  needsApproval?: boolean;
  outcome?: "done" | "error" | "interrupted" | null;
}): CharacterState {
  if (input.runState === "waiting") return "waiting";
  if (input.thinking || input.runState === "running") return "working";
  if (input.outcome === "error" || input.outcome === "interrupted")
    return input.outcome;
  if (input.needsApproval) return "waiting";
  return input.outcome ?? "ready";
}

export type CharacterColor = "body" | "edge" | "face" | "shine" | "coat";
export const CHARACTER_LAYERS = [
  "back",
  "feet",
  "left-paw",
  "right-paw",
  "body",
  "face",
  "eyes",
  "front",
  "sparkles",
] as const;
export type CharacterLayer = (typeof CHARACTER_LAYERS)[number];
export type CharacterPart = {
  key: string;
  layer: CharacterLayer;
  d: string;
  fill: CharacterColor | "none";
  stroke?: CharacterColor;
  strokeWidth?: number;
  opacity?: number;
};

/** Original orbit spirit, drawn once for both SVG renderers (120 × 120). */
export function characterArt(
  appearance: CharacterAppearance,
  state: CharacterState,
): CharacterPart[] {
  const parts: CharacterPart[] = [];
  const add = (
    key: string,
    layer: CharacterLayer,
    d: string,
    fill: CharacterPart["fill"] = "none",
    stroke?: CharacterColor,
    strokeWidth = 2,
    opacity = 1,
  ) => parts.push({ key, layer, d, fill, stroke, strokeWidth, opacity });
  const oval = (x: number, y: number, rx: number, ry: number) =>
    `M ${x - rx} ${y} a ${rx} ${ry} 0 1 0 ${rx * 2} 0 a ${rx} ${ry} 0 1 0 -${rx * 2} 0`;
  if (appearance.ring === "orbit")
    add(
      "ring-back",
      "back",
      "M 13 75 C 2 52 105 34 108 59",
      "none",
      "edge",
      2.5,
      0.65,
    );
  if (appearance.ring === "halo")
    add("halo", "back", oval(60, 17, 21, 5), "none", "edge", 2.5, 0.8);
  add("left-foot", "feet", "M 35 92 C 20 99 27 110 43 105 L 51 97 Z", "coat");
  add("right-foot", "feet", "M 69 97 L 77 105 C 93 110 100 99 85 92 Z", "coat");
  add(
    "left-paw",
    "left-paw",
    "M 29 64 C 13 57 8 66 15 78 C 20 87 28 85 33 76 Z",
    "coat",
  );
  add(
    "left-paw-pad",
    "left-paw",
    oval(20, 73, 3, 4),
    "shine",
    undefined,
    0,
    0.5,
  );
  add(
    "right-paw",
    "right-paw",
    "M 91 64 C 107 57 112 66 105 78 C 100 87 92 85 87 76 Z",
    "coat",
  );
  add(
    "right-paw-pad",
    "right-paw",
    oval(100, 73, 3, 4),
    "shine",
    undefined,
    0,
    0.5,
  );
  const bodies = {
    orb: "M 60 28 C 82 24 99 43 99 65 C 102 90 85 103 60 103 C 35 103 18 90 21 65 C 21 43 38 24 60 28 Z",
    pebble:
      "M 44 31 C 50 21 62 22 70 29 C 87 28 99 48 98 70 C 100 92 84 103 59 103 C 33 103 20 89 22 67 C 19 48 29 31 44 31 Z",
    spark:
      "M 59 25 C 66 25 70 35 77 39 C 84 43 95 40 98 49 C 102 58 94 65 93 73 C 93 84 98 94 88 98 C 78 103 70 97 60 99 C 50 103 42 108 34 100 C 27 93 31 84 27 76 C 23 68 15 62 21 54 C 26 46 36 47 43 42 C 50 37 50 26 59 25 Z",
  };
  add("body", "body", bodies[appearance.body], "coat");
  add(
    "belly",
    "body",
    "M 30 66 C 29 48 43 39 60 39 C 78 39 91 48 90 66 C 90 85 78 94 60 94 C 42 94 30 84 30 66 Z",
    "shine",
    undefined,
    0,
    0.45,
  );
  add(
    "forehead-light",
    "body",
    "M 37 39 Q 48 30 59 34",
    "none",
    "shine",
    3,
    0.75,
  );
  add("sprout-stem", "body", "M 60 29 Q 60 20 64 17", "none", "edge", 2.5);
  add(
    "sprout",
    "body",
    "M 63 21 C 62 12 69 10 76 12 C 75 20 71 24 63 21 Z",
    "edge",
  );
  add("sprout-light", "body", "M 65 19 L 71 15", "none", "shine", 1.5, 0.6);
  add("left-cheek", "face", oval(36, 72, 6, 3.5), "edge", undefined, 0, 0.25);
  add("right-cheek", "face", oval(84, 72, 6, 3.5), "edge", undefined, 0, 0.25);
  const sad = state === "error" || state === "interrupted";
  if (state === "done" || (appearance.eyes === "soft" && !sad)) {
    add(
      "eyes",
      "eyes",
      "M 39 63 Q 46 54 53 63 M 67 63 Q 74 54 81 63",
      "none",
      "face",
      3.5,
    );
  } else {
    const rx = appearance.eyes === "bright" ? 8.5 : 7;
    add(
      "eyes",
      "eyes",
      oval(46, 61, rx, sad ? 7 : 9) + " " + oval(74, 61, rx, sad ? 7 : 9),
      "face",
    );
    add(
      "eye-glints",
      "eyes",
      oval(43.5, 57.5, 2.8, 3) + " " + oval(71.5, 57.5, 2.8, 3),
      "shine",
    );
    add(
      "eye-glints-small",
      "eyes",
      oval(48.5, 64.5, 1.3, 1.3) + " " + oval(76.5, 64.5, 1.3, 1.3),
      "shine",
      undefined,
      0,
      0.7,
    );
  }
  if (sad)
    add(
      "sad-brows",
      "face",
      "M 40 49 Q 47 50 51 46 M 69 46 Q 73 50 80 49",
      "none",
      "face",
      2,
      0.7,
    );
  const mouths: Record<CharacterState, string> = {
    ready: "M 54 75 Q 60 82 66 75",
    working: "M 55 77 Q 60 80 65 77",
    waiting: oval(60, 77, 3, 4),
    done: "M 51 74 Q 60 78 69 74 Q 67 86 60 86 Q 53 86 51 74 Z",
    error: "M 54 80 Q 60 74 66 80",
    interrupted: "M 55 78 L 65 78",
  };
  add(
    "mouth",
    "face",
    mouths[state],
    state === "done" ? "face" : "none",
    "face",
    2.5,
  );
  if (state === "done")
    add(
      "smile-light",
      "face",
      "M 56 82 Q 60 80 64 82",
      "none",
      "shine",
      2,
      0.7,
    );
  if (state === "waiting")
    add("curious-brow", "face", "M 69 46 Q 76 43 81 48", "none", "face", 2);
  if (appearance.ring === "orbit") {
    add(
      "ring-front",
      "front",
      "M 108 59 C 119 79 19 103 13 75",
      "none",
      "edge",
      2.5,
      0.85,
    );
    add("satellite", "front", oval(96, 81, 3.5, 3.5), "edge", "shine", 1.5);
  }
  if (appearance.accessory === "glasses")
    add(
      "glasses",
      "front",
      oval(46, 61, 13, 12) +
        " " +
        oval(74, 61, 13, 12) +
        " M 59 60 Q 60 58 61 60 M 33 58 L 28 56 M 87 58 L 92 56",
      "none",
      "edge",
      2.5,
    );
  if (appearance.accessory === "headphones") {
    add("headband", "front", "M 23 62 C 19 16 101 16 97 62", "none", "face", 4);
    add(
      "earpieces",
      "front",
      "M 20 58 Q 18 58 18 62 L 18 75 Q 18 80 25 80 Q 30 80 30 75 L 30 63 Q 30 58 25 58 Z M 95 58 Q 90 58 90 63 L 90 75 Q 90 80 95 80 Q 102 80 102 75 L 102 62 Q 102 58 100 58 Z",
      "edge",
    );
    add(
      "earpiece-light",
      "front",
      "M 22 64 L 22 73 M 98 64 L 98 73",
      "none",
      "shine",
      2,
      0.55,
    );
  }
  if (appearance.accessory === "cap") {
    add("cap", "front", "M 33 37 Q 35 19 58 21 Q 79 21 84 37 Z", "edge");
    add(
      "cap-brim",
      "front",
      "M 33 37 Q 55 31 88 36 Q 98 39 89 43 Q 59 38 33 41 Z",
      "edge",
      "body",
      1.5,
    );
  }
  add(
    "sparkle-left",
    "sparkles",
    "M 14 39 Q 14 44 9 44 Q 14 44 14 49 Q 14 44 19 44 Q 14 44 14 39 Z",
    "edge",
  );
  add(
    "sparkle-right",
    "sparkles",
    "M 103 25 Q 103 32 97 32 Q 103 32 103 39 Q 103 32 109 32 Q 103 32 103 25 Z",
    "edge",
  );
  return parts;
}

export type CharacterPose = {
  y: number;
  tilt: number;
  breath: number;
  blink: number;
  look: number;
  leftPaw: number;
  rightPaw: number;
  halo: number;
  sparkle: number;
};
/** Shared deterministic rig. Time starts again on state changes; greeting lasts 1.8s. */
export function characterPose(
  state: CharacterState,
  elapsed: number,
  greetingElapsed = Infinity,
): CharacterPose {
  const t = Math.max(0, elapsed) / 1000;
  const cycle = t % 4.8;
  const blink =
    cycle > 3.9 && cycle < 4.08
      ? Math.max(0.08, Math.abs(cycle - 3.99) / 0.09)
      : 1;
  const wave = greetingElapsed >= 0 && greetingElapsed < 1800;
  const celebrating = state === "done" && t < 1.8;
  const greeting = wave ? greetingElapsed / 1000 : t;
  const busy = state === "working";
  const sad = state === "error" || state === "interrupted";
  return {
    y: celebrating
      ? -Math.abs(Math.sin(t * Math.PI * 2.2)) * 6
      : Math.sin(t * 2) * (sad ? 0.5 : 1.5),
    tilt: wave
      ? Math.sin(greeting * 4) * 3
      : state === "waiting"
        ? -7 + Math.sin(t * 1.4) * 2
        : busy
          ? Math.sin(t * 2.2) * 4
          : sad
            ? 3
            : Math.sin(t * 1.1) * 1.5,
    breath: 1 + Math.sin(t * 2) * 0.012,
    blink: state === "done" ? 1 : blink,
    look: busy ? Math.sin(t * 1.6) * 2.5 : state === "waiting" ? 2 : 0,
    leftPaw: celebrating ? Math.sin(t * 14) * 16 + 25 : Math.sin(t * 2) * 3,
    rightPaw:
      wave || celebrating
        ? -75 + Math.sin(greeting * 18) * 18
        : busy
          ? -12 + Math.sin(t * 3) * 8
          : Math.sin(t * 2) * -3,
    halo: Math.sin(t * 1.5) * 2,
    sparkle:
      wave || celebrating
        ? 0.6 + Math.sin(greeting * 10) * 0.4
        : busy
          ? 0.35 + Math.sin(t * 3) * 0.25
          : 0.25,
  };
}

export const STILL_CHARACTER_POSE: Readonly<CharacterPose> = Object.freeze({
  y: 0,
  tilt: 0,
  breath: 1,
  blink: 1,
  look: 0,
  leftPaw: 0,
  rightPaw: 0,
  halo: 0,
  sparkle: 0,
});

/** SVG transforms use explicit pivots so the two clients have identical movement. */
export function characterLayerTransform(
  layer: CharacterLayer,
  pose: CharacterPose,
): string | undefined {
  if (layer === "left-paw") return `rotate(${pose.leftPaw} 29 67)`;
  if (layer === "right-paw") return `rotate(${pose.rightPaw} 91 67)`;
  if (layer === "eyes")
    return `translate(${pose.look} 61) scale(1 ${pose.blink}) translate(0 -61)`;
  if (layer === "face") return `translate(${pose.look * 0.5} 0)`;
  if (layer === "back") return `translate(0 ${pose.halo})`;
  return undefined;
}
