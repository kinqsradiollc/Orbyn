import React, { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Brand } from "../components/Brand";
import { Button } from "../components/Button";
import { ErrorBanner } from "../components/ErrorBanner";
import { client } from "../lib/api";
import { session } from "../lib/session";
import { colors, fonts, themed } from "../theme";
import { shared } from "../styles";
import { errorText } from "../lib/errors";

/**
 * Shown to a signed-in user who hasn't confirmed their email. The confirmation
 * link opens the web app; once they've followed it, "I've confirmed" re-reads
 * their account and lets them in.
 */
export function VerifyGateScreen({
  email,
  busy,
  act,
  onContinue,
  onSignOut,
}: {
  email: string;
  busy: boolean;
  act: (fn: () => Promise<void>) => Promise<void>;
  onContinue: () => void;
  onSignOut: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const lock = useRef(false);
  const mounted = useRef(false);
  const owner = useRef(session.token);
  const current = () => mounted.current && owner.current === session.token;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const resend = async () => {
    if (busy || lock.current || !current()) return;
    lock.current = true;
    setSending(true);
    setNote("");
    setError("");
    try {
      await act(async () => {
        try {
          await client.resendVerification();
          if (current()) setNote("Email sent. Check your inbox.");
        } catch (e) {
          if (current()) setError(errorText(e));
        }
      });
    } catch (e) {
      if (current()) setError(errorText(e));
    } finally {
      lock.current = false;
      if (current()) setSending(false);
    }
  };

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[
        s.scroll,
        {
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + 24,
          paddingLeft: insets.left + 24,
          paddingRight: insets.right + 24,
        },
      ]}
      style={s.screen}
    >
      <View style={s.column}>
        <View>
          <Brand size={30} />
        </View>
        <View>
          <Text style={s.hero}>Confirm your email</Text>
          <Text style={[shared.subtitle, s.intro]}>
            Open the link sent to {email}, then return here to continue.
          </Text>
        </View>
        <View>
          {!!note && <Text style={s.note}>{note}</Text>}
          <ErrorBanner error={error} />
          <Button
            title="Continue"
            icon="arrowRight"
            disabled={busy || sending}
            onPress={onContinue}
          />
          <Button
            title={sending ? "Sending…" : "Resend email"}
            secondary
            disabled={busy || sending}
            onPress={() => void resend()}
            style={s.gap}
          />
          <Button
            title="Sign out"
            secondary
            disabled={busy || sending}
            onPress={onSignOut}
            style={s.gap}
          />
        </View>
      </View>
    </ScrollView>
  );
}

const s = themed(() =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    scroll: { flexGrow: 1, justifyContent: "center" },
    column: { width: "100%", maxWidth: 440, alignSelf: "center" },
    hero: {
      fontFamily: fonts.display,
      fontSize: 24,
      marginTop: 24,
      lineHeight: 32,
      letterSpacing: -0.4,
      color: colors.text,
    },
    intro: { marginBottom: 20 },
    note: {
      fontFamily: fonts.regular,
      fontSize: 15,
      color: colors.muted,
      marginBottom: 12,
    },
    gap: { marginTop: 12 },
  }),
);
