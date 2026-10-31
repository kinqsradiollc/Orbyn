import "./week-art.css";

type Piece = {
  title: string;
  day: number;
  top: number;
  size: number;
  height: 7 | 12 | 20;
  kind: "event" | "session";
  lift?: number;
};

/** An illustration of the Calendar's 3D week, with example work. */
const PIECES: Piece[] = [
  { title: "Standup", day: 0, top: 20, size: 26, height: 7, kind: "event" },
  {
    title: "Design review",
    day: 0,
    top: 96,
    size: 54,
    height: 12,
    kind: "event",
  },
  { title: "Thesis", day: 0, top: 210, size: 78, height: 20, kind: "session" },
  { title: "Standup", day: 1, top: 20, size: 26, height: 7, kind: "event" },
  { title: "Lecture", day: 1, top: 74, size: 90, height: 12, kind: "event" },
  {
    title: "Budget notes",
    day: 1,
    top: 222,
    size: 54,
    height: 20,
    kind: "session",
  },
  { title: "Workshop", day: 2, top: 58, size: 120, height: 12, kind: "event" },
  {
    title: "Launch sync",
    day: 2,
    top: 184,
    size: 70,
    height: 12,
    kind: "event",
  },
  {
    title: "Onboarding",
    day: 2,
    top: 258,
    size: 62,
    height: 12,
    kind: "session",
  },
  { title: "Standup", day: 3, top: 20, size: 26, height: 7, kind: "event" },
  {
    title: "Budget review",
    day: 3,
    top: 96,
    size: 54,
    height: 12,
    kind: "event",
  },
  {
    title: "Checklist",
    day: 3,
    top: 122,
    size: 54,
    height: 12,
    kind: "session",
    lift: 22,
  },
  { title: "Thesis", day: 4, top: 74, size: 96, height: 20, kind: "session" },
  { title: "Demo", day: 4, top: 240, size: 54, height: 12, kind: "event" },
];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

export function WeekIllustration() {
  return (
    <div className="week-art" aria-hidden="true">
      <div className="week-art-world">
        {DAYS.map((day, index) => (
          <div
            key={day}
            className={`week-art-lane${index === 2 ? " is-over" : ""}`}
            style={{ left: index * 120 }}
          >
            <span>{day}</span>
          </div>
        ))}
        {PIECES.map((piece, index) => (
          <div
            key={index}
            className={`week-art-block is-${piece.kind}`}
            style={
              {
                "--x": `${piece.day * 120 + 5}px`,
                "--y": `${piece.top}px`,
                "--z": `${piece.lift ?? 0}px`,
                "--d": `${piece.size}px`,
                "--h": `${piece.height}px`,
              } as React.CSSProperties
            }
          >
            <i className="south" />
            <i className="west" />
            <b>{piece.title}</b>
          </div>
        ))}
      </div>
      <small>Example week</small>
    </div>
  );
}
