import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { motion } from "@orbyn/core";
import { Brand } from "../components/Brand";
import { Button } from "../components/Button";
import { ErrorBanner } from "../components/ErrorBanner";
import { client } from "../lib/api";
import { FadeIn } from "../motion";
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

  const resend = () =>
    act(async () => {
      setNote("");
      setError("");
      try {
        await client.resendVerification();
        setNote("Sent. Check your inbox for the new link.");
      } catch (e) {
        setError(errorText(e));
      }
    });

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
        <FadeIn index={0} duration={motion.slow}>
          <Brand size={30} />
        </FadeIn>
        <FadeIn index={2} duration={motion.slow}>
          <Text style={[shared.eyebrow, s.eyebrow]}>ONE LAST STEP</Text>
          <Text style={s.hero}>Confirm{"\n"}your email.</Text>
          <Text style={[shared.subtitle, s.intro]}>
            We sent a confirmation link to {email}. Open it on this device to
            start using Orbyn, then come back and continue.
          </Text>
        </FadeIn>
        <FadeIn index={4} duration={motion.slow}>
          {!!note && <Text style={s.note}>{note}</Text>}
          <ErrorBanner error={error} />
          <Button
            title="I've confirmed — continue"
            icon="arrowRight"
            disabled={busy}
            onPress={onContinue}
          />
          <Button
            title={busy ? "Sending…" : "Resend the email"}
            secondary
            disabled={busy}
            onPress={() => void resend()}
            style={s.gap}
          />
          <Button
            title="Sign out"
            destructive
            disabled={busy}
            onPress={onSignOut}
            style={s.gap}
          />
        </FadeIn>
      </View>
    </ScrollView>
  );
}

const s = themed(() =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    scroll: { flexGrow: 1, justifyContent: "center" },
    column: { width: "100%", maxWidth: 440, alignSelf: "center" },
    eyebrow: { marginTop: 36 },
    hero: {
      fontFamily: fonts.display,
      fontSize: 38,
      lineHeight: 44,
      letterSpacing: -1.4,
      color: colors.text,
    },
    intro: { marginBottom: 28 },
    note: {
      fontFamily: fonts.regular,
      fontSize: 14,
      color: colors.muted,
      marginBottom: 12,
    },
    gap: { marginTop: 12 },
  }),
);
