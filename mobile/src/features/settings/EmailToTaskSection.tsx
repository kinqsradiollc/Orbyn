import React, { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import type { InboxInfo } from "@orbyn/core";
import { SettingsSection } from "./SettingsSection";
import { MoreMenu, ActionSheet } from "../../components/MoreMenu";
import { InlineDetails } from "../../components/InlineDetails";
import { SmallAction } from "../../components/SmallAction";
import { ErrorBanner } from "../../components/ErrorBanner";
import { shared } from "../../styles";
import { client } from "../../lib/api";
import { copyText } from "../../lib/share";
import { session } from "../../lib/session";

export function EmailToTaskSection({
  inbox,
  busy,
  unavailable,
  recovery,
  act,
  onChanged,
}: {
  inbox: InboxInfo | null;
  busy: boolean;
  unavailable: boolean;
  recovery: React.ReactNode;
  act: (operation: () => Promise<void>) => Promise<void>;
  onChanged: (value: InboxInfo) => void;
}) {
  const [confirmation, setConfirmation] = useState<{
    action: "replace" | "disable";
    address: string;
  } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const writing = useRef(false);
  const mounted = useRef(true);
  const account = useRef(session.token).current;
  const latest = useRef(inbox);
  latest.current = inbox;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const current = () => mounted.current && account === session.token;
  const disabled = busy || unavailable || pending;
  const run = async (operation: () => Promise<void>) => {
    if (!current() || disabled || writing.current) return;
    writing.current = true;
    setPending(true);
    setError("");
    setNotice("");
    let started = false;
    try {
      await act(async () => {
        if (!current()) return;
        started = true;
        try {
          await operation();
        } catch {
          if (current()) setError("Couldn't update email-to-task. Try again.");
        }
      });
      if (current() && !started) setError("Email-to-task is busy. Try again.");
    } catch {
      if (current()) setError("Couldn't update email-to-task. Try again.");
    } finally {
      writing.current = false;
      if (current()) setPending(false);
    }
  };
  const enable = () => {
    void run(async () => {
      if (!latest.current?.configured || latest.current.address) return;
      const saved = await client.rotateInbox();
      if (current()) {
        onChanged(saved);
        setNotice("Address ready.");
      }
    });
  };
  return (
    <SettingsSection title="Email to task">
      {recovery}
      <Text style={shared.small}>Send from your account email.</Text>
      {inbox === null ? (
        !unavailable && <Text style={shared.small}>Loading address…</Text>
      ) : !inbox.configured ? (
        <Text style={shared.small}>
          An admin needs to enable inbound mail first.
        </Text>
      ) : inbox.address ? (
        <View style={{ gap: 8 }}>
          <Text
            selectable
            style={shared.body}
            accessibilityLabel="Your email-to-task address"
          >
            {inbox.address}
          </Text>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <SmallAction
              label="Copy address"
              disabled={disabled}
              onPress={() => {
                void run(async () => {
                  const address = latest.current?.address;
                  if (
                    address &&
                    !(await copyText(address, "Address copied")) &&
                    current()
                  )
                    setError(
                      "Couldn't copy the address. Select it to copy manually.",
                    );
                });
              }}
            />
            <MoreMenu
              label="Email-to-task options"
              disabled={disabled}
              actions={[
                {
                  label: "Replace address",
                  disabled,
                  onPress: () => {
                    if (latest.current?.address)
                      setConfirmation({
                        action: "replace",
                        address: latest.current.address,
                      });
                  },
                },
                {
                  label: "Turn off",
                  destructive: true,
                  disabled,
                  onPress: () => {
                    if (latest.current?.address)
                      setConfirmation({
                        action: "disable",
                        address: latest.current.address,
                      });
                  },
                },
              ]}
            />
          </View>
        </View>
      ) : (
        <SmallAction label="Enable" disabled={disabled} onPress={enable} />
      )}
      <InlineDetails title="How email becomes tasks">
        <Text style={shared.small}>
          The subject becomes the title and the body becomes notes. Use your
          account email as the sender.
        </Text>
      </InlineDetails>
      <ErrorBanner error={error} />
      {!!notice && (
        <Text style={shared.small} accessibilityLiveRegion="polite">
          {notice}
        </Text>
      )}
      {pending && (
        <Text style={shared.small} accessibilityLiveRegion="polite">
          Updating email-to-task…
        </Text>
      )}
      <ActionSheet
        visible={!!confirmation}
        label="Email-to-task change"
        title={
          confirmation?.action === "replace"
            ? "Replace email address?"
            : "Turn off email-to-task?"
        }
        message="Mail sent to your current address will stop creating tasks."
        cancelLabel={
          confirmation?.action === "replace" ? "Keep address" : "Keep enabled"
        }
        onClose={() => setConfirmation(null)}
        actions={[
          {
            label:
              confirmation?.action === "replace"
                ? "Replace address"
                : "Turn off",
            destructive: confirmation?.action === "disable",
            disabled,
            onPress: () => {
              const target = confirmation;
              if (!target) return;
              void run(async () => {
                if (
                  !latest.current?.configured ||
                  latest.current.address !== target.address
                ) {
                  if (current())
                    setError("The address changed. Review it and try again.");
                  return;
                }
                if (target.action === "replace") {
                  const saved = await client.rotateInbox();
                  if (current()) {
                    onChanged(saved);
                    setNotice("Address replaced.");
                  }
                } else {
                  await client.disableInbox();
                  if (current() && latest.current) {
                    onChanged({ ...latest.current, address: null });
                    setNotice("Email-to-task is off.");
                  }
                }
              });
            },
          },
        ]}
      />
    </SettingsSection>
  );
}
