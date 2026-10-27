import React, { useEffect, useRef, useState } from "react";
import { Text, TextInput, View, StyleSheet } from "react-native";
import type { AiChatSummary } from "@orbyn/core";
import { BottomSheet } from "../../components/BottomSheet";
import { Icon } from "../../components/Icon";
import { Pressable } from "../../motion";
import { SmallAction } from "../../components/SmallAction";
import { client } from "../../lib/api";
import { session } from "../../lib/session";
import { shared } from "../../styles";
import { colors, fonts, themed } from "../../theme";

export function ProjectChats({
  projectId,
  onOpen,
  onClose,
}: {
  projectId: string;
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  const [chats, setChats] = useState<AiChatSummary[]>([]);
  const [search, setSearch] = useState("");
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const writing = useRef(false);
  const alive = useRef(true);
  const token = useRef(session.token);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const current = () => alive.current && token.current === session.token;
  useEffect(() => {
    let active = true;
    setLoading(true);
    setChats([]);
    setError("");
    client.aiChats({ project_id: projectId, search, limit: 100 }).then(
      (rows) => {
        if (active && current()) {
          setChats(rows);
          setLoading(false);
        }
      },
      () => {
        if (active && current()) {
          setError("Couldn't load chats. Try again.");
          setLoading(false);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [projectId, search, revision]);
  const pin = async (chat: AiChatSummary) => {
    if (writing.current || !current()) return;
    writing.current = true;
    setPending(chat.id);
    setError("");
    try {
      await client.updateAiChat(chat.id, { pinned: !chat.pinned });
      if (current()) setRevision((value) => value + 1);
    } catch {
      if (current()) setError("Couldn't update pin. Try again.");
    } finally {
      writing.current = false;
      if (current()) setPending(null);
    }
  };
  return (
    <BottomSheet
      visible
      title="Project chats"
      onClose={onClose}
      closeDisabled={!!pending}
    >
      <TextInput
        style={shared.input}
        accessibilityLabel="Search project chats"
        placeholder="Search chats"
        placeholderTextColor={colors.faint}
        value={search}
        maxLength={200}
        onChangeText={setSearch}
      />
      {!!error && (
        <View>
          <Text style={styles.error} accessibilityRole="alert">
            {error}
          </Text>
          <SmallAction
            label="Retry"
            disabled={!!pending}
            onPress={() => setRevision((value) => value + 1)}
          />
        </View>
      )}
      {loading ? (
        <Text style={shared.small} accessibilityLiveRegion="polite">
          Loading chats…
        </Text>
      ) : !error && chats.length === 0 ? (
        <Text style={shared.small}>
          {search ? "No chats match" : "No project chats yet"}
        </Text>
      ) : null}
      {!loading &&
        chats.map((chat) => (
          <View key={chat.id} style={styles.row}>
            <Pressable
              accessibilityRole="button"
              disabled={!!pending}
              onPress={() => onOpen(chat.id)}
              style={styles.open}
            >
              <Text style={styles.title}>{chat.title}</Text>
              <Text style={shared.small}>
                {chat.swept_at
                  ? "Summary saved"
                  : chat.active === "needs_you"
                    ? "Needs you"
                    : chat.active === "working"
                      ? "Working"
                      : new Date(chat.last_used_at).toLocaleDateString()}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${chat.pinned ? "Unpin" : "Pin"} ${chat.title}`}
              accessibilityState={{
                selected: chat.pinned,
                disabled: !!pending,
              }}
              disabled={!!pending}
              onPress={() => void pin(chat)}
              style={styles.pin}
            >
              <Icon
                name="pin"
                size={18}
                color={chat.pinned ? colors.accent : colors.textSoft}
              />
            </Pressable>
          </View>
        ))}
    </BottomSheet>
  );
}
const styles = themed(() =>
  StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    open: {
      flex: 1,
      minWidth: 0,
      minHeight: 44,
      justifyContent: "center",
      gap: 4,
      paddingVertical: 10,
    },
    title: { color: colors.text, fontSize: 15, fontFamily: fonts.medium },
    error: { color: colors.danger, fontSize: 13, fontFamily: fonts.regular },
    pin: {
      width: 44,
      minHeight: 44,
      alignItems: "center",
      justifyContent: "center",
    },
  }),
);
