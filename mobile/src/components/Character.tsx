import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { AppState, Platform, View } from "react-native";
import Svg, {
  Defs,
  Ellipse,
  G,
  LinearGradient,
  Path,
  Stop,
} from "react-native-svg";
import {
  characterArt,
  characterAppearance,
  characterPose,
  characterLayerTransform,
  CHARACTER_LAYERS,
  CHARACTER_STATE_LABELS,
  STILL_CHARACTER_POSE,
  type CharacterAppearance,
  type CharacterColor,
  type CharacterState,
} from "@orbyn/core";
import { useReducedMotion } from "../motion";
import { colors, useTheme } from "../theme";

/** Shared SVG rig at 30fps, paused while hidden, inactive, static or motion-reduced. */
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
  useTheme();
  const value = characterAppearance(appearance);
  const gradient = `character-${useId().replace(/:/g, "")}`;
  const reduced = useReducedMotion();
  const [active, setActive] = useState(
    AppState.currentState !== "background" &&
      AppState.currentState !== "inactive",
  );
  const [visible, setVisible] = useState(false);
  const host = useRef<View>(null);
  const greetedAt = useRef(-Infinity);
  const [pose, setPose] = useState(STILL_CHARACTER_POSE);
  const art = useMemo(
    () => characterArt(value, state),
    [value.body, value.eyes, value.ring, value.accessory, state],
  );
  useEffect(() => {
    if (greeting) greetedAt.current = performance.now();
  }, [greeting]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) =>
      setActive(next === "active"),
    );
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    const node = host.current;
    if (
      typeof IntersectionObserver === "undefined" ||
      !node ||
      !(node instanceof Element)
    ) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) =>
      setVisible(entry.isIntersecting),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [value.presence, preview]);
  useEffect(() => {
    setPose(STILL_CHARACTER_POSE);
    if (!active || !visible || reduced || value.presence !== "animated") return;
    const start = performance.now();
    let frame = 0,
      last = -Infinity;
    const tick = (now: number) => {
      if (now - last >= 1000 / 30) {
        setPose(characterPose(state, now - start, now - greetedAt.current));
        last = now;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, visible, reduced, value.presence, state]);
  if (value.presence === "hidden" && !preview) return null;
  const palette: Record<CharacterColor, string> = {
    body:
      value.palette === "fern"
        ? colors.accentSoft
        : value.palette === "sage"
          ? colors.soft
          : colors.surfaceMuted,
    edge:
      value.palette === "fern"
        ? colors.accent
        : value.palette === "sage"
          ? colors.dot
          : colors.textSoft,
    face: colors.text,
    shine: colors.surface,
    coat: `url(#${gradient})`,
  };
  return (
    <View
      ref={host}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${name}: ${CHARACTER_STATE_LABELS[state]}`}
      style={{ width: size, height: size }}
    >
      <Svg
        width={size}
        height={size}
        viewBox="0 0 120 120"
        accessible={Platform.OS === "web" ? undefined : false}
      >
        <Defs>
          <LinearGradient id={gradient} x1="0%" y1="0%" x2="75%" y2="100%">
            <Stop offset="0" stopColor={palette.shine} />
            <Stop offset="0.4" stopColor={palette.body} />
            <Stop offset="1" stopColor={palette.edge} stopOpacity={0.7} />
          </LinearGradient>
        </Defs>
        <Ellipse
          cx={60}
          cy={109}
          rx={29}
          ry={4}
          fill={palette.edge}
          opacity={0.12}
        />
        <G
          transform={`translate(0 ${pose.y}) rotate(${pose.tilt} 60 85) translate(60 90) scale(${pose.breath}) translate(-60 -90)`}
        >
          {CHARACTER_LAYERS.map((layer) => (
            <G
              key={layer}
              transform={characterLayerTransform(layer, pose)}
              opacity={layer === "sparkles" ? pose.sparkle : 1}
            >
              {art
                .filter((part) => part.layer === layer)
                .map((part) => (
                  <Path
                    key={part.key}
                    d={part.d}
                    fill={part.fill === "none" ? "none" : palette[part.fill]}
                    stroke={part.stroke ? palette[part.stroke] : undefined}
                    strokeWidth={part.strokeWidth}
                    opacity={part.opacity}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ))}
            </G>
          ))}
        </G>
      </Svg>
    </View>
  );
}
