import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { onCelebrate } from "../lib/celebrate";

/** How long the moment stays on screen. */
const SHOWN_MS = 1600;

/** Compact completion feedback, without confetti or entrance motion. */
export function Celebration() {
  /** When the current moment started; 0 when nothing is shown. */
  const [shown, setShown] = useState(0);
  useEffect(() => onCelebrate(() => setShown(Date.now())), []);
  useEffect(() => {
    if (!shown) return;
    const id = setTimeout(() => setShown(0), SHOWN_MS);
    return () => clearTimeout(id);
  }, [shown]);

  return (
    <>
      <div className="sr-only" role="status">
        {shown ? "Task marked done." : ""}
      </div>
      {shown > 0 && (
        <div key={shown} className="celebrate" aria-hidden="true">
          <span className="celebrate-card">
            <CheckCircle2 size={17} />
            Task completed
          </span>
        </div>
      )}
    </>
  );
}
