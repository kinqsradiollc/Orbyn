import { defineRelease } from "./release.js";

export default defineRelease({
  id: "2026-09-19-screens",
  date: "2026-09-19",
  title: "Fits every screen",
  summary:
    "The web and phone apps fit any screen size, and the assistant became a proper chat.",
  sections: {
    new: [
      "The assistant is laid out as a chat on the web.",
      "Orbyn has its own icon in your browser tab.",
    ],
    better: [
      "The web and phone apps fit every screen size, from small phones to wide monitors.",
      "The assistant works on your answer in the background, so long questions no longer time out.",
    ],
    fixed: [
      "The assistant acts when you tell it something is already done.",
      "The planner no longer stumbles on days with no free time.",
    ],
  },
});
