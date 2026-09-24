import React from "react";
import { Switch as NativeSwitch, type SwitchProps } from "react-native";
import { tap } from "../lib/haptics";

/**
 * The system switch, with a light tap when it flips. Used everywhere a
 * switch is, so every toggle in the app feels the same under the thumb.
 */
export function Switch({ onValueChange, ...props }: SwitchProps) {
  return (
    <NativeSwitch
      {...props}
      onValueChange={
        onValueChange
          ? (value) => {
              tap();
              return onValueChange(value);
            }
          : undefined
      }
    />
  );
}
