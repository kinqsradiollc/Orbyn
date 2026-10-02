import { z } from "zod";

export const CHARACTER_BODIES = [
  "orb",
  "pebble",
  "spark",
  "cloud",
  "bean",
  "heart",
  "pudding",
  "diamond",
  "marshmallow",
] as const;
export const CHARACTER_PALETTES = [
  "fern",
  "sage",
  "ink",
  "honey",
  "coral",
  "paper",
] as const;
export const CHARACTER_EYES = [
  "round",
  "soft",
  "bright",
  "sleepy",
  "starry",
  "wink",
] as const;
export const CHARACTER_RINGS = ["orbit", "halo", "none"] as const;
export const CHARACTER_ACCESSORIES = [
  "none",
  "glasses",
  "headphones",
  "cap",
] as const;
export const CHARACTER_EARS = [
  "sprout",
  "none",
  "bunny",
  "cat",
  "bear",
  "fox",
  "antenna",
] as const;
export const CHARACTER_TAILS = [
  "none",
  "curl",
  "fluffy",
  "fin",
  "comet",
] as const;
export const CHARACTER_HEADWEAR = [
  "none",
  "beanie",
  "crown",
  "bucket",
  "wizard",
  "beret",
  "flower",
  "bow",
] as const;
export const CHARACTER_EYEWEAR = [
  "none",
  "spectacles",
  "sunglasses",
  "heart-shades",
  "monocle",
  "visor",
] as const;
export const CHARACTER_NECKWEAR = [
  "none",
  "scarf",
  "bowtie",
  "ribbon",
  "bell",
  "bandana",
  "tie",
] as const;
export const CHARACTER_OUTFITS = [
  "none",
  "hoodie",
  "overalls",
  "sweater",
  "tuxedo",
  "raincoat",
  "spacesuit",
] as const;
export const CHARACTER_BACKWEAR = [
  "none",
  "wings",
  "cape",
  "backpack",
  "leaf-wings",
] as const;
export const CHARACTER_MARKINGS = [
  "plain",
  "freckles",
  "stars",
  "stripes",
  "patch",
  "heart-mark",
] as const;
export const CHARACTER_MOVEMENTS = ["gentle", "bouncy", "floaty"] as const;
export const CHARACTER_PRESENCE = ["animated", "static", "hidden"] as const;

/** Curated parts keep every combination compatible with the same character. */
export const characterAppearanceInput = z
  .object({
    body: z.enum(CHARACTER_BODIES).default("orb"),
    palette: z.enum(CHARACTER_PALETTES).default("fern"),
    eyes: z.enum(CHARACTER_EYES).default("round"),
    ring: z.enum(CHARACTER_RINGS).default("orbit"),
    accessory: z.enum(CHARACTER_ACCESSORIES).default("none"),
    ears: z.enum(CHARACTER_EARS).default("sprout"),
    tail: z.enum(CHARACTER_TAILS).default("none"),
    headwear: z.enum(CHARACTER_HEADWEAR).default("none"),
    eyewear: z.enum(CHARACTER_EYEWEAR).default("none"),
    neckwear: z.enum(CHARACTER_NECKWEAR).default("none"),
    outfit: z.enum(CHARACTER_OUTFITS).default("none"),
    backwear: z.enum(CHARACTER_BACKWEAR).default("none"),
    markings: z.enum(CHARACTER_MARKINGS).default("plain"),
    movement: z.enum(CHARACTER_MOVEMENTS).default("gentle"),
    presence: z.enum(CHARACTER_PRESENCE).default("animated"),
  })
  .strict();
export type CharacterAppearance = z.output<typeof characterAppearanceInput>;
export const DEFAULT_CHARACTER: Readonly<CharacterAppearance> = Object.freeze(
  characterAppearanceInput.parse({}),
);
export const CHARACTER_LABELS: Record<string, string> = {
  cloud: "Cloud",
  bean: "Bean",
  heart: "Heart",
  pudding: "Pudding",
  diamond: "Diamond",
  marshmallow: "Marshmallow",
  sleepy: "Sleepy",
  starry: "Starry",
  wink: "Wink",
  sprout: "Sprout",
  bunny: "Bunny",
  cat: "Cat",
  bear: "Bear",
  fox: "Fox",
  antenna: "Antennae",
  curl: "Curly",
  fluffy: "Fluffy",
  fin: "Fin",
  comet: "Comet",
  beanie: "Beanie",
  crown: "Crown",
  bucket: "Bucket hat",
  wizard: "Wizard hat",
  beret: "Beret",
  flower: "Flower",
  bow: "Bow",
  spectacles: "Round glasses",
  sunglasses: "Sunglasses",
  "heart-shades": "Heart shades",
  monocle: "Monocle",
  visor: "Visor",
  scarf: "Scarf",
  bowtie: "Bow tie",
  ribbon: "Ribbon",
  bell: "Bell",
  bandana: "Bandana",
  tie: "Tie",
  hoodie: "Hoodie",
  overalls: "Overalls",
  sweater: "Sweater",
  tuxedo: "Tuxedo",
  raincoat: "Raincoat",
  spacesuit: "Spacesuit",
  wings: "Angel wings",
  cape: "Cape",
  backpack: "Backpack",
  "leaf-wings": "Leaf wings",
  plain: "Plain",
  freckles: "Freckles",
  stars: "Stars",
  stripes: "Stripes",
  patch: "Patch",
  "heart-mark": "Heart patch",
  gentle: "Gentle",
  bouncy: "Bouncy",
  floaty: "Floaty",
  orb: "Orb",
  pebble: "Pebble",
  spark: "Spark",
  honey: "Honey",
  coral: "Coral",
  paper: "Paper",
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
/** One catalog powers both editors; independent slots can be worn together. */
export const CHARACTER_SECTIONS = [
  {
    id: "shape",
    label: "Shape",
    fields: [
      { key: "body", label: "Body shape", options: CHARACTER_BODIES },
      { key: "ears", label: "Ears & sprout", options: CHARACTER_EARS },
      { key: "tail", label: "Tail", options: CHARACTER_TAILS },
      { key: "eyes", label: "Eyes", options: CHARACTER_EYES },
    ],
  },
  {
    id: "wardrobe",
    label: "Wardrobe",
    fields: [
      { key: "headwear", label: "Headwear", options: CHARACTER_HEADWEAR },
      { key: "eyewear", label: "Eyewear", options: CHARACTER_EYEWEAR },
      { key: "neckwear", label: "Neckwear", options: CHARACTER_NECKWEAR },
      { key: "outfit", label: "Outfit", options: CHARACTER_OUTFITS },
      { key: "backwear", label: "Backwear", options: CHARACTER_BACKWEAR },
      {
        key: "accessory",
        label: "Extra accessory",
        options: CHARACTER_ACCESSORIES,
      },
    ],
  },
  {
    id: "finish",
    label: "Finish",
    fields: [
      { key: "palette", label: "Palette", options: CHARACTER_PALETTES },
      { key: "markings", label: "Markings", options: CHARACTER_MARKINGS },
      { key: "ring", label: "Aura", options: CHARACTER_RINGS },
    ],
  },
  {
    id: "motion",
    label: "Motion",
    fields: [
      {
        key: "movement",
        label: "Movement style",
        options: CHARACTER_MOVEMENTS,
      },
      { key: "presence", label: "Presence", options: CHARACTER_PRESENCE },
    ],
  },
] as const;
export const CHARACTER_PRESETS: readonly {
  name: string;
  appearance: CharacterAppearance;
}[] = [
  { name: "Sprout", appearance: { ...DEFAULT_CHARACTER } },
  {
    name: "Cozy bunny",
    appearance: {
      ...DEFAULT_CHARACTER,
      body: "bean",
      ears: "bunny",
      outfit: "hoodie",
      headwear: "beanie",
      ring: "none",
      markings: "freckles",
    },
  },
  {
    name: "Space cat",
    appearance: {
      ...DEFAULT_CHARACTER,
      body: "marshmallow",
      ears: "cat",
      tail: "curl",
      outfit: "spacesuit",
      eyewear: "visor",
      movement: "floaty",
    },
  },
  {
    name: "Cloud angel",
    appearance: {
      ...DEFAULT_CHARACTER,
      body: "cloud",
      ears: "none",
      backwear: "wings",
      ring: "halo",
      palette: "sage",
      eyes: "soft",
      movement: "floaty",
    },
  },
  {
    name: "Little wizard",
    appearance: {
      ...DEFAULT_CHARACTER,
      body: "spark",
      ears: "none",
      headwear: "wizard",
      backwear: "cape",
      markings: "stars",
      eyewear: "monocle",
      ring: "none",
    },
  },
  {
    name: "Heartthrob",
    appearance: {
      ...DEFAULT_CHARACTER,
      body: "heart",
      ears: "none",
      eyewear: "heart-shades",
      neckwear: "bowtie",
      ring: "none",
      movement: "bouncy",
    },
  },
  {
    name: "Forest fox",
    appearance: {
      ...DEFAULT_CHARACTER,
      body: "pebble",
      ears: "fox",
      tail: "fluffy",
      neckwear: "bandana",
      backwear: "leaf-wings",
      ring: "none",
    },
  },
  {
    name: "Study bear",
    appearance: {
      ...DEFAULT_CHARACTER,
      body: "pudding",
      ears: "bear",
      eyewear: "spectacles",
      outfit: "overalls",
      accessory: "headphones",
      palette: "ink",
      ring: "none",
    },
  },
];

/** Random looks retain visibility and movement preferences, and avoid duplicate eyewear/hats. */
export function randomCharacterAppearance(
  current: CharacterAppearance,
  random = Math.random,
): CharacterAppearance {
  const next = { ...current };
  for (const section of CHARACTER_SECTIONS)
    for (const field of section.fields) {
      if (field.key === "presence" || field.key === "movement") continue;
      const options: readonly string[] = field.options;
      const index = Math.min(
        options.length - 1,
        Math.max(0, Math.floor(random() * options.length)),
      );
      Object.assign(next, { [field.key]: options[index] });
    }
  if (next.accessory === "cap" && next.headwear !== "none")
    next.accessory = "none";
  if (next.accessory === "glasses" && next.eyewear !== "none")
    next.accessory = "none";
  return next;
}

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
  "tail",
  "feet",
  "left-paw",
  "right-paw",
  "body",
  "clothes",
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
    cloud:
      "M 27 47 C 15 36 25 22 39 29 C 42 13 62 15 67 28 C 82 19 99 29 93 45 C 110 51 108 70 97 75 C 106 94 86 108 72 99 C 62 110 45 107 39 99 C 20 106 10 86 23 76 C 9 70 12 50 27 47 Z",
    bean: "M 72 24 C 96 29 105 54 96 77 C 89 96 66 109 44 102 C 19 95 16 71 25 53 C 31 42 42 47 46 37 C 51 25 59 20 72 24 Z",
    heart:
      "M 60 39 C 44 16 19 25 20 49 C 18 69 36 89 60 103 C 84 89 102 69 100 49 C 101 25 76 16 60 39 Z",
    pudding:
      "M 43 29 Q 60 23 77 29 Q 84 30 87 44 L 101 86 Q 105 101 87 103 L 33 103 Q 15 101 19 86 L 33 44 Q 36 30 43 29 Z",
    diamond:
      "M 60 23 Q 66 23 71 29 L 97 57 Q 105 65 97 74 L 70 99 Q 60 110 50 99 L 23 74 Q 15 65 23 57 L 49 29 Q 54 23 60 23 Z",
    marshmallow:
      "M 41 29 L 79 29 Q 98 29 98 49 L 98 82 Q 98 103 78 103 L 42 103 Q 22 103 22 82 L 22 49 Q 22 29 41 29 Z",
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
  if (
    appearance.ears === "sprout" &&
    appearance.headwear === "none" &&
    appearance.accessory !== "cap"
  ) {
    add("sprout-stem", "body", "M 60 29 Q 60 20 64 17", "none", "edge", 2.5);
    add(
      "sprout",
      "body",
      "M 63 21 C 62 12 69 10 76 12 C 75 20 71 24 63 21 Z",
      "edge",
    );
    add("sprout-light", "body", "M 65 19 L 71 15", "none", "shine", 1.5, 0.6);
  }
  const ears: Partial<Record<CharacterAppearance["ears"], string>> = {
    bunny:
      "M 30 39 C 18 12 28 0 36 12 L 46 34 Z M 74 34 L 84 12 C 92 0 102 12 90 39 Z",
    cat: "M 26 45 L 26 17 Q 27 10 33 17 L 49 33 Z M 71 33 L 87 17 Q 93 10 94 17 L 94 45 Z",
    bear: oval(30, 32, 13, 13) + " " + oval(90, 32, 13, 13),
    fox: "M 25 46 L 17 15 Q 16 7 23 13 L 51 34 Z M 69 34 L 97 13 Q 104 7 103 15 L 95 46 Z",
    antenna: "M 39 32 Q 27 20 34 12 M 81 32 Q 93 20 86 12",
  };
  if (ears[appearance.ears]) {
    add(
      "ears",
      "back",
      ears[appearance.ears]!,
      appearance.ears === "antenna" ? "none" : "coat",
      "edge",
      2,
    );
    if (appearance.ears === "antenna")
      add(
        "antenna-tips",
        "back",
        oval(34, 12, 4, 4) + " " + oval(86, 12, 4, 4),
        "edge",
      );
    else
      add(
        "inner-ears",
        "back",
        oval(32, 27, 4, appearance.ears === "bunny" ? 10 : 5) +
          " " +
          oval(88, 27, 4, appearance.ears === "bunny" ? 10 : 5),
        "shine",
        undefined,
        0,
        0.6,
      );
  }
  const tails: Partial<Record<CharacterAppearance["tail"], string>> = {
    curl: "M 87 93 C 115 99 118 76 105 73 C 95 71 94 86 104 86",
    fluffy: "M 83 98 Q 102 108 113 83 L 106 84 L 112 66 Q 90 69 86 84 Z",
    fin: "M 86 94 Q 113 105 115 78 Q 100 79 86 94 Z",
    comet: "M 87 94 Q 111 89 113 56 Q 104 66 98 64 Q 104 89 87 94 Z",
  };
  if (tails[appearance.tail])
    add(
      "tail",
      "tail",
      tails[appearance.tail]!,
      appearance.tail === "curl" ? "none" : "coat",
      "edge",
      5,
    );
  const backs: Partial<Record<CharacterAppearance["backwear"], string>> = {
    wings:
      "M 31 63 Q 7 34 3 49 Q 0 62 14 70 Q 3 67 7 78 Q 12 89 33 83 Z M 89 63 Q 113 34 117 49 Q 120 62 106 70 Q 117 67 113 78 Q 108 89 87 83 Z",
    cape: "M 35 71 Q 22 85 18 105 Q 60 113 102 105 Q 98 85 85 71 Z",
    backpack: "M 90 60 Q 109 57 112 69 L 112 91 Q 110 103 90 98 Z",
    "leaf-wings":
      "M 31 66 Q 10 30 2 39 Q 0 66 31 83 Z M 89 66 Q 110 30 118 39 Q 120 66 89 83 Z",
  };
  if (backs[appearance.backwear])
    add(
      "backwear",
      "back",
      backs[appearance.backwear]!,
      appearance.backwear === "wings" ? "shine" : "edge",
      "body",
      2,
    );
  const star = (x: number, y: number, size: number) =>
    `M ${x} ${y - size} L ${x + size * 0.3} ${y - size * 0.3} L ${x + size} ${y} L ${x + size * 0.3} ${y + size * 0.3} L ${x} ${y + size} L ${x - size * 0.3} ${y + size * 0.3} L ${x - size} ${y} L ${x - size * 0.3} ${y - size * 0.3} Z`;
  const markings: Partial<Record<CharacterAppearance["markings"], string>> = {
    freckles:
      oval(34, 70, 1, 1) +
      " " +
      oval(39, 73, 1, 1) +
      " " +
      oval(36, 76, 1, 1) +
      " " +
      oval(86, 70, 1, 1) +
      " " +
      oval(81, 73, 1, 1) +
      " " +
      oval(84, 76, 1, 1),
    stars: star(33, 79, 4) + " " + star(86, 43, 4),
    stripes: "M 30 46 L 36 50 M 28 54 L 34 58 M 84 50 L 90 46 M 86 58 L 92 54",
    patch: "M 27 50 Q 32 40 42 46 Q 52 49 51 61 Q 51 72 38 72 Q 27 67 27 50 Z",
    "heart-mark": "M 81 76 C 72 67 70 82 81 88 C 92 82 90 67 81 76 Z",
  };
  if (markings[appearance.markings])
    add(
      "markings",
      "body",
      markings[appearance.markings]!,
      appearance.markings === "stripes" ? "none" : "edge",
      "edge",
      2,
      0.45,
    );
  if (appearance.outfit !== "none") {
    add(
      "outfit",
      "clothes",
      "M 28 81 Q 60 92 92 81 L 87 98 Q 60 109 33 98 Z",
      "edge",
    );
    const details: Record<
      Exclude<CharacterAppearance["outfit"], "none">,
      string
    > = {
      hoodie: "M 42 84 L 43 95 M 78 84 L 77 95 M 49 99 Q 60 93 71 99",
      overalls:
        "M 42 83 L 42 101 M 78 83 L 78 101 M 46 87 L 74 87 L 73 98 L 47 98 Z",
      sweater: "M 36 92 Q 60 102 84 92 M 35 97 Q 60 107 85 97",
      tuxedo: "M 42 84 L 60 104 L 78 84 L 69 84 L 60 97 L 51 84 Z",
      raincoat: "M 60 90 L 60 104 M 35 93 L 49 93 M 71 93 L 85 93",
      spacesuit:
        "M 45 87 L 75 87 L 75 98 L 45 98 Z M 53 92 L 57 92 M 64 92 L 68 92",
    };
    add(
      "outfit-detail",
      "clothes",
      details[appearance.outfit],
      "none",
      "shine",
      2,
      0.8,
    );
  }
  add("left-cheek", "face", oval(36, 72, 6, 3.5), "edge", undefined, 0, 0.25);
  add("right-cheek", "face", oval(84, 72, 6, 3.5), "edge", undefined, 0, 0.25);
  const sad = state === "error" || state === "interrupted";
  if (
    state === "done" ||
    (["soft", "sleepy"].includes(appearance.eyes) && !sad)
  ) {
    add(
      "eyes",
      "eyes",
      appearance.eyes === "sleepy" && state !== "done"
        ? "M 39 61 Q 46 66 53 61 M 67 61 Q 74 66 81 61"
        : "M 39 63 Q 46 54 53 63 M 67 63 Q 74 54 81 63",
      "none",
      "face",
      3.5,
    );
  } else {
    const rx = appearance.eyes === "bright" ? 8.5 : 7;
    add(
      "eyes",
      "eyes",
      appearance.eyes === "starry" && !sad
        ? star(46, 61, 9) + " " + star(74, 61, 9)
        : oval(46, 61, rx, sad ? 7 : 9) + " " + oval(74, 61, rx, sad ? 7 : 9),
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
  if (appearance.eyes === "wink" && !sad && state !== "done") {
    add("wink-cover", "eyes", oval(46, 61, 10, 11), "body");
    add("wink", "eyes", "M 39 63 Q 46 55 53 63", "none", "face", 3);
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
  if (
    (appearance.accessory === "glasses" && appearance.eyewear === "none") ||
    appearance.eyewear === "spectacles"
  )
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
  if (appearance.accessory === "cap" && appearance.headwear === "none") {
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
  const eyewear: Partial<Record<CharacterAppearance["eyewear"], string>> = {
    sunglasses:
      "M 32 54 L 57 54 L 55 65 Q 45 76 34 65 Z M 63 54 L 88 54 L 86 65 Q 75 76 65 65 Z M 57 58 L 63 58",
    "heart-shades":
      "M 46 55 C 33 43 26 61 46 74 C 66 61 59 43 46 55 Z M 74 55 C 61 43 54 61 74 74 C 94 61 87 43 74 55 Z M 59 58 L 61 58",
    monocle: oval(74, 61, 13, 12) + " M 85 68 Q 96 87 84 92",
    visor: "M 31 50 Q 60 44 89 50 L 89 64 Q 60 72 31 64 Z",
  };
  if (eyewear[appearance.eyewear]) {
    add(
      "eyewear",
      "front",
      eyewear[appearance.eyewear]!,
      ["sunglasses", "heart-shades"].includes(appearance.eyewear)
        ? "face"
        : "none",
      "edge",
      2.5,
    );
    if (appearance.eyewear !== "monocle")
      add(
        "lens-light",
        "front",
        "M 38 55 L 45 53 M 72 53 L 79 55",
        "none",
        "shine",
        2,
        0.7,
      );
  }
  const hats: Partial<Record<CharacterAppearance["headwear"], string>> = {
    beanie:
      "M 30 36 Q 28 13 59 15 Q 90 13 90 36 Z M 29 35 L 91 35 L 91 43 Q 60 38 29 43 Z",
    crown: "M 34 34 L 30 17 L 47 26 L 60 10 L 73 26 L 90 17 L 86 34 Z",
    bucket: "M 37 17 L 80 17 L 89 34 L 100 40 Q 60 47 20 40 L 31 34 Z",
    wizard: "M 36 33 Q 51 21 65 3 Q 72 20 85 33 L 100 41 Q 59 48 23 40 Z",
    beret: "M 27 32 Q 17 18 52 15 Q 82 9 92 25 Q 100 36 74 37 L 35 37 Z",
    flower:
      oval(83, 23, 8, 5) + " " + oval(83, 23, 5, 8) + " " + oval(83, 23, 3, 3),
    bow: "M 60 25 Q 32 8 35 28 Q 34 37 60 28 Q 86 37 85 28 Q 88 8 60 25 Z",
  };
  if (hats[appearance.headwear]) {
    add("headwear", "front", hats[appearance.headwear]!, "edge", "body", 1.5);
    if (appearance.headwear === "beanie")
      add("pompom", "front", oval(60, 12, 6, 6), "edge", "shine", 1.5);
    if (appearance.headwear === "wizard")
      add("hat-star", "front", star(65, 27, 4), "shine");
    if (appearance.headwear === "crown")
      add("crown-jewel", "front", star(60, 27, 4), "shine");
  }
  const necks: Partial<Record<CharacterAppearance["neckwear"], string>> = {
    scarf:
      "M 31 83 Q 60 92 89 83 L 87 91 Q 60 101 33 91 Z M 75 93 L 84 94 L 80 109 L 70 106 Z",
    bowtie: "M 60 89 L 47 82 L 47 96 Z M 60 89 L 73 82 L 73 96 Z",
    ribbon:
      "M 60 88 L 49 83 L 49 93 Z M 60 88 L 71 83 L 71 93 Z M 58 91 L 51 104 L 61 100 L 68 104 L 64 91 Z",
    bell: "M 35 84 Q 60 93 85 84 M 55 92 Q 60 84 65 92 L 67 98 L 53 98 Z M 58 100 L 62 100",
    bandana: "M 34 83 Q 60 91 86 83 L 60 103 Z",
    tie: "M 57 86 L 63 86 L 64 91 L 68 103 L 60 109 L 52 103 L 56 91 Z",
  };
  if (necks[appearance.neckwear])
    add("neckwear", "front", necks[appearance.neckwear]!, "body", "face", 1.5);
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
  movement: CharacterAppearance["movement"] = "gentle",
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
  const bounce = movement === "bouncy" ? 3 : movement === "floaty" ? 2 : 1;
  const sad = state === "error" || state === "interrupted";
  return {
    y: celebrating
      ? -Math.abs(Math.sin(t * Math.PI * 2.2)) * 6
      : (movement === "bouncy"
          ? -Math.abs(Math.sin(t * 3))
          : Math.sin(t * (movement === "floaty" ? 1.2 : 2))) *
        (sad ? 0.5 : 1.5 * bounce),
    tilt: wave
      ? Math.sin(greeting * 4) * 3
      : state === "waiting"
        ? -7 + Math.sin(t * 1.4) * 2
        : busy
          ? Math.sin(t * 2.2) * 4
          : sad
            ? 3
            : Math.sin(t * 1.1) * 1.5 * bounce,
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
  if (layer === "tail") return `rotate(${pose.leftPaw * 2} 87 92)`;
  if (layer === "left-paw") return `rotate(${pose.leftPaw} 29 67)`;
  if (layer === "right-paw") return `rotate(${pose.rightPaw} 91 67)`;
  if (layer === "eyes")
    return `translate(${pose.look} 61) scale(1 ${pose.blink}) translate(0 -61)`;
  if (layer === "face") return `translate(${pose.look * 0.5} 0)`;
  if (layer === "back") return `translate(0 ${pose.halo})`;
  return undefined;
}
