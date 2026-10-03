import { test } from "node:test";
import assert from "node:assert/strict";
import { pdfTextLines } from "./helpers/pdf-text.js";

test("PDF assertions preserve contiguous font runs, ligatures and separate lines", () => {
  const pages = [
    {
      text: {
        width: 100,
        height: 100,
        spans: [
          { text: "fl", x: 10, y: 90, w: 5, size: 10 },
          { text: "owchart", x: 15, y: 90, w: 35, size: 10 },
          { text: "Task status", x: 10, y: 70, w: 50, size: 10 },
          { text: "ﬂowchart", x: 10, y: 50, w: 40, size: 10 },
        ],
      },
    },
  ];
  assert.deepEqual(pdfTextLines(pages), [
    "flowchart",
    "Task status",
    "flowchart",
  ]);
});
