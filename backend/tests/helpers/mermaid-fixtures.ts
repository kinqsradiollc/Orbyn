export const mermaidFixtures = [
  { kind: "flowchart", source: "flowchart TD\n A[Start] --> B[Finish]" },
  {
    kind: "sequence",
    source:
      "sequenceDiagram\n participant A as Alice\n participant B as Bob\n A->>B: Hello\n B-->>A: Ready",
  },
  {
    kind: "state",
    source: "stateDiagram-v2\n [*] --> Draft\n Draft --> Ready\n Ready --> [*]",
  },
  {
    kind: "class",
    source:
      "classDiagram\n class Task {\n +String title\n +complete()\n }\n Project --> Task",
  },
  {
    kind: "er",
    source:
      "erDiagram\n PROJECT ||--o{ TASK : contains\n TASK {\n string title\n }",
  },
  {
    kind: "gantt",
    source:
      "gantt\n title Release plan\n dateFormat YYYY-MM-DD\n section Work\n Review :2026-10-01, 2d\n Release :2026-10-03, 1d",
  },
  { kind: "pie", source: 'pie title Task status\n "Done" : 3\n "Open" : 2' },
  {
    kind: "journey",
    source:
      "journey\n title Planning day\n section Morning\n Review tasks: 5: User\n Plan work: 4: User",
  },
  {
    kind: "mindmap",
    source: "mindmap\n root((Project))\n  Tasks\n   Review\n  Notes",
  },
  {
    kind: "timeline",
    source:
      "timeline\n title Release history\n September : Planning\n October : Release",
  },
] as const;
