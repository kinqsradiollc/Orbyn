import React, { useState } from "react";
import { Text, View } from "react-native";
import { isClosed, type Item } from "@orbyn/core";
import { Button } from "./Button";
import { client } from "../lib/api";
import { shared } from "../styles";
import { errorText } from "../lib/errors";

/** Hand a saved task over now or for tonight, or take it back. */
export function TaskAgent({
  item,
  disabled,
  onChanged,
}: {
  item: Item;
  disabled: boolean;
  onChanged?: () => void;
}) {
  const [held, setHeld] = useState(!!item.agent_grant_id);
  const [when, setWhen] = useState(item.agent_when ?? "now");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const hand = async (next: "now" | "tonight" | "back") => {
    setBusy(true);
    setMessage("");
    try {
      const saved =
        next === "back"
          ? await client.takeTaskBack(item.id)
          : await client.handTaskToAgent(item.id, next);
      setHeld(!!saved.agent_grant_id);
      setWhen(saved.agent_when ?? "now");
      setMessage(
        next === "tonight"
          ? "Waiting for tonight. Enable night shift in Assistant settings to run it."
          : next === "back"
            ? "Taken back from your assistant."
            : "Your assistant will work on this in the background.",
      );
      onChanged?.();
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  };
  if (isClosed(item.status)) return null;
  return (
    <View style={{ gap: 8 }}>
      <Text style={shared.label}>Your assistant</Text>
      {held && (
        <Text style={shared.small}>
          {when === "tonight"
            ? "Waiting for tonight"
            : "Handed to your assistant"}
        </Text>
      )}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Button
          title="Now"
          disabled={disabled || busy}
          onPress={() => void hand("now")}
        />
        <Button
          title="Tonight"
          disabled={disabled || busy}
          onPress={() => void hand("tonight")}
        />
        {held && (
          <Button
            title="Take back"
            disabled={disabled || busy}
            onPress={() => void hand("back")}
          />
        )}
      </View>
      {!!message && <Text style={shared.small}>{message}</Text>}
    </View>
  );
}
