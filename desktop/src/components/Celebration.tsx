import { useEffect, useState } from "react";
import { PartyPopper } from "lucide-react";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { onCelebrate } from "../lib/celebrate";

/** How long the moment stays on screen. */
const SHOWN_MS = 1600;

/**
 * A small "Nicely done." and a burst of dots when a task is marked done
 * anywhere (see lib/celebrate.ts), in the style of focus mode's celebration.
 * With reduced motion nothing is shown; screen readers still hear it.
 */
export function Celebration() {
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
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
      {shown > 0 && !reduceMotion && (
        <div key={shown} className="celebrate" aria-hidden="true">
          <span className="celebrate-burst">
            {Array.from({ length: 10 }, (_, n) => (
              <i key={n} style={{ "--n": n } as never} />
            ))}
          </span>
          <span className="celebrate-card">
            <PartyPopper size={17} />
            Nicely done.
          </span>
        </div>
      )}
    </>
  );
}
