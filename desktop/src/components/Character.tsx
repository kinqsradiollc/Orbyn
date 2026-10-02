import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  characterArt,
  characterAppearance,
  characterPose,
  characterLayerTransform,
  CHARACTER_LAYERS,
  CHARACTER_STATE_LABELS,
  STILL_CHARACTER_POSE,
  type CharacterAppearance,
  type CharacterState,
} from "@orbyn/core";
import "./character.css";

/** Orbyn's layered companion, with the same rig and artwork as the native client. */
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
  preview?: boolean;
  greeting?: number;
}) {
  const value = characterAppearance(appearance);
  const gradient = `character-${useId().replace(/:/g, "")}`;
  const ref = useRef<SVGSVGElement>(null);
  const greetedAt = useRef(-Infinity);
  const [visible, setVisible] = useState(false);
  const [foreground, setForeground] = useState(
    () => typeof document !== "undefined" && !document.hidden,
  );
  const [reduced, setReduced] = useState(
    () =>
      typeof window === "undefined" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [pose, setPose] = useState(STILL_CHARACTER_POSE);
  const art = useMemo(
    () => characterArt(value, state),
    [
      value.body,
      value.eyes,
      value.ring,
      value.accessory,
      value.ears,
      value.tail,
      value.headwear,
      value.eyewear,
      value.neckwear,
      value.outfit,
      value.backwear,
      value.markings,
      state,
    ],
  );
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const changed = () => setReduced(query.matches);
    query.addEventListener("change", changed);
    return () => query.removeEventListener("change", changed);
  }, []);
  useEffect(() => {
    if (greeting) greetedAt.current = performance.now();
  }, [greeting]);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) =>
      setVisible(entry.isIntersecting),
    );
    observer.observe(node);
    const changed = () => setForeground(!document.hidden);
    document.addEventListener("visibilitychange", changed);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", changed);
    };
  }, [value.presence, preview]);
  useEffect(() => {
    setPose(STILL_CHARACTER_POSE);
    if (value.presence !== "animated" || !visible || !foreground || reduced)
      return;
    const start = performance.now();
    let frame = 0,
      last = -Infinity;
    const tick = (now: number) => {
      if (now - last >= 1000 / 30) {
        setPose(
          characterPose(
            state,
            now - start,
            now - greetedAt.current,
            value.movement,
          ),
        );
        last = now;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value.presence, visible, foreground, reduced, state, value.movement]);
  if (value.presence === "hidden" && !preview) return null;
  return (
    <svg
      ref={ref}
      viewBox="-8 -10 136 132"
      width={size}
      height={size}
      className={`orbyn-character character-${value.palette}`}
      role="img"
      aria-label={`${name}: ${CHARACTER_STATE_LABELS[state]}`}
    >
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="0.75" y2="1">
          <stop offset="0" stopColor="var(--character-shine)" />
          <stop offset="0.4" stopColor="var(--character-body)" />
          <stop
            offset="1"
            stopColor="var(--character-edge)"
            stopOpacity="0.7"
          />
        </linearGradient>
      </defs>
      <ellipse
        cx="60"
        cy="109"
        rx="29"
        ry="4"
        fill="var(--character-edge)"
        opacity="0.12"
      />
      <g
        transform={`translate(0 ${pose.y}) rotate(${pose.tilt} 60 85) translate(60 90) scale(${pose.breath}) translate(-60 -90)`}
      >
        {CHARACTER_LAYERS.map((layer) => (
          <g
            key={layer}
            data-character-layer={layer}
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
                        ? `url(#${gradient})`
                        : `var(--character-${part.fill})`
                  }
                  stroke={
                    part.stroke ? `var(--character-${part.stroke})` : undefined
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
