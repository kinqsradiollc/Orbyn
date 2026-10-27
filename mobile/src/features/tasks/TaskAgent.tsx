import React, { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { isClosed, type Item } from "@orbyn/core";
import { Button } from "../../components/Button";
import { client } from "../../lib/api";
import { shared } from "../../styles";
import { errorText } from "../../lib/errors";

export function TaskAgent(props: Parameters<typeof TaskAgentBody>[0]) {
  return <TaskAgentBody key={props.item.id} {...props} />;
}

/** Hand a saved task over now or for tonight, or take it back. */
function TaskAgentBody({
  item,
  disabled,
  onChanged,
}: {
  item: Item;
  disabled: boolean;
  onChanged?: () => void;
}) {
  const mutation = useRef(false);
  const [held, setHeld] = useState(!!item.agent_grant_id);
  const [when, setWhen] = useState(item.agent_when ?? "now");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    setHeld(!!item.agent_grant_id);
    setWhen(item.agent_when ?? "now");
  }, [item.agent_grant_id, item.agent_when]);
  const hand = async (next: "now" | "tonight" | "back") => {
    if (mutation.current || disabled || isClosed(item.status)) return;
    mutation.current = true;
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
          ? "Queued for tonight. Overnight must be enabled."
          : next === "back"
            ? "Taken back."
            : "Handed to Background.",
      );
      onChanged?.();
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  };
  if (isClosed(item.status)) return null;
  return (
    <View style={{ gap: 8 }}>
      <Text style={shared.label}>Agent work</Text>
      {held && (
        <Text style={shared.small}>
          {when === "tonight" ? "Waiting for tonight" : "Handed to Background"}
        </Text>
      )}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Button
          title="Background"
          secondary
          disabled={disabled || busy}
          onPress={() => void hand("now")}
        />
        <Button
          title="Overnight"
          secondary
          disabled={disabled || busy}
          onPress={() => void hand("tonight")}
        />
        {held && (
          <Button
            title="Take back"
            secondary
            disabled={disabled || busy}
            onPress={() => void hand("back")}
          />
        )}
      </View>
      {!!message && <Text style={shared.small}>{message}</Text>}
    </View>
  );
}
