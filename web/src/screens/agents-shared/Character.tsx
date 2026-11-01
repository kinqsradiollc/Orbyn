import "./agents-shared.css";
import {
  CHARACTER_LAYERS,
  CHARACTER_STATE_LABELS,
  characterAppearance,
  characterArt,
  characterLayerTransform,
  characterPose,
  STILL_CHARACTER_POSE,
  type CharacterAppearance,
  type CharacterState,
} from "@orbyn/core";
import { useEffect, useId, useMemo, useRef, useState } from "react";

const stillness = () => matchMedia("(prefers-reduced-motion: reduce)");

/**
 * Shared artwork with motion only for active work or a brief explicit greeting.
 * Ready previews hold still, and hidden/reduced-motion characters schedule no frames.
 */
export function Character({
  appearance,
  state = "ready",
  size = 48,
  name = "Orbyn",
  preview = false,
  greeting = 0,
}: {
  appearance?: CharacterAppearance;
  state?: CharacterState;
  size?: number;
  name?: string;
  /** In the editor: draw even when the saved presence is hidden. */
  preview?: boolean;
  greeting?: number;
}) {
  const look = characterAppearance(appearance);
  const coat = `coat-${useId().replace(/\W/g, "")}`;
  const art = useMemo(
    () => characterArt(look, state),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(look), state],
  );
  const node = useRef<SVGSVGElement>(null);
  const greetedAt = useRef(-Infinity);
  const finishedAt = useRef(performance.now());
  const [waving, setWaving] = useState(false);
  const [celebrating, setCelebrating] = useState(state === "done");
  const [pose, setPose] = useState(STILL_CHARACTER_POSE);
  const [visible, setVisible] = useState(false);
  const [shown, setShown] = useState(!document.hidden);
  const [reduced, setReduced] = useState(() => stillness().matches);

  useEffect(() => {
    const query = stillness();
    const changed = () => setReduced(query.matches);
    const show = () => setShown(!document.hidden);
    query.addEventListener("change", changed);
    document.addEventListener("visibilitychange", show);
    return () => {
      query.removeEventListener("change", changed);
      document.removeEventListener("visibilitychange", show);
    };
  }, []);
  useEffect(() => {
    if (!greeting) return;
    greetedAt.current = performance.now();
    setWaving(true);
    const timer = window.setTimeout(() => setWaving(false), 1800);
    return () => window.clearTimeout(timer);
  }, [greeting]);
  useEffect(() => {
    setCelebrating(state === "done");
    if (state !== "done") return;
    finishedAt.current = performance.now();
    const timer = window.setTimeout(() => setCelebrating(false), 1800);
    return () => window.clearTimeout(timer);
  }, [state]);
  useEffect(() => {
    if (!node.current) return;
    const watcher = new IntersectionObserver(([entry]) =>
      setVisible(entry.isIntersecting),
    );
    watcher.observe(node.current);
    return () => watcher.disconnect();
  }, [look.presence, preview]);

  const moving =
    look.presence === "animated" &&
    visible &&
    shown &&
    !reduced &&
    (state === "working" || waving || celebrating);
  useEffect(() => {
    setPose(
      state === "ready" || state === "done"
        ? STILL_CHARACTER_POSE
        : characterPose(state, 0, Infinity, look.movement),
    );
    if (!moving) return;
    const start = performance.now();
    let frame = 0;
    let last = -Infinity;
    const tick = (now: number) => {
      if (document.hidden || stillness().matches) return;
      if (
        state !== "working" &&
        now -
          Math.max(
            greetedAt.current,
            state === "done" ? finishedAt.current : -Infinity,
          ) >=
          1800
      ) {
        setPose(STILL_CHARACTER_POSE);
        return;
      }
      if (now - last >= 1000 / 30) {
        setPose(
          characterPose(
            state,
            now - start,
            now - greetedAt.current,
            look.movement,
          ),
        );
        last = now;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [moving, state, look.movement]);

  if (look.presence === "hidden" && !preview) return null;
  return (
    <svg
      ref={node}
      viewBox="-8 -10 136 132"
      width={size}
      height={size}
      className={`agents-character agents-palette-${look.palette}`}
      role="img"
      aria-label={`${name}: ${CHARACTER_STATE_LABELS[state]}`}
    >
      <defs>
        <linearGradient id={coat} x1="0" y1="0" x2="0.75" y2="1">
          <stop offset="0" stopColor="var(--char-shine)" />
          <stop offset="0.4" stopColor="var(--char-body)" />
          <stop offset="1" stopColor="var(--char-edge)" stopOpacity="0.7" />
        </linearGradient>
      </defs>
      <ellipse
        cx="60"
        cy="109"
        rx="29"
        ry="4"
        fill="var(--char-edge)"
        opacity="0.12"
      />
      <g
        transform={`translate(0 ${pose.y}) rotate(${pose.tilt} 60 85) translate(60 90) scale(${pose.breath}) translate(-60 -90)`}
      >
        {CHARACTER_LAYERS.map((layer) => (
          <g
            key={layer}
            transform={characterLayerTransform(layer, pose)}
            opacity={layer === "sparkles" ? pose.sparkle : 1}
          >
            {art
              .filter((part) => part.layer === layer)
              .map((part) => (
                <path
                  key={part.key}
                  d={part.d}
                  fill={
                    part.fill === "none"
                      ? "none"
                      : part.fill === "coat"
                        ? `url(#${coat})`
                        : `var(--char-${part.fill})`
                  }
                  stroke={
                    part.stroke ? `var(--char-${part.stroke})` : undefined
                  }
                  strokeWidth={part.strokeWidth}
                  opacity={part.opacity}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
          </g>
        ))}
      </g>
    </svg>
  );
}
