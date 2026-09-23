import React, { useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  MINIMUM_AGE,
  motion,
  type LegalDoc,
  type LegalSummary,
  type User,
} from "@orbyn/core";
import { Brand } from "../components/Brand";
import { Button } from "../components/Button";
import { ErrorBanner } from "../components/ErrorBanner";
import { Icon } from "../components/Icon";
import { LegalSheet } from "../components/LegalSheet";
import { client } from "../lib/api";
import { FadeIn } from "../motion";
import { colors, fonts, themed } from "../theme";
import { shared } from "../styles";

/**
 * Held before the app when you haven't agreed to the current Terms and
 * Privacy Policy — the same gate as the desktop, with the usage-analytics
 * choice shown up front.
 */
export function ConsentGateScreen({
  user,
  legal,
  busy,
  act,
  onAccepted,
  onSignOut,
}: {
  user: User;
  legal: LegalSummary;
  busy: boolean;
  act: (fn: () => Promise<void>) => Promise<void>;
  onAccepted: () => void;
  onSignOut: () => void;
}) {
  const insets = useSafeAreaInsets();
  const updated = !!user.terms_version;
  const [agreed, setAgreed] = useState(false);
  const [analytics, setAnalytics] = useState(!user.analytics_opt_out);
  const [reading, setReading] = useState<LegalDoc | null>(null);
  const [error, setError] = useState("");

  const accept = () =>
    act(async () => {
      setError("");
      try {
        await client.acceptTerms(legal.terms_version);
        if (analytics === !!user.analytics_opt_out)
          await client.setPrivacy({ analytics_opt_out: !analytics });
        onAccepted();
      } catch (e) {
        setError((e as Error).message || "That didn't go through. Try again.");
      }
    });

  return (
    <>
      <ScrollView
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
            <Text style={[shared.eyebrow, s.eyebrow]}>
              {updated ? "WE'VE UPDATED OUR TERMS" : "BEFORE YOU CONTINUE"}
            </Text>
            <Text style={s.hero}>Your privacy{"\n"}and our terms.</Text>
            <Text style={[shared.subtitle, s.intro]}>
              {updated
                ? "The Terms of Service or Privacy Policy changed since you last agreed. Take a look, then carry on."
                : "Please review how Orbyn works with your data and agree to the terms to keep using it."}
            </Text>
          </FadeIn>
          <FadeIn index={4} duration={motion.slow}>
            <View style={s.docs}>
              <Button
                secondary
                title="Terms of Service"
                icon="fileText"
                style={s.doc}
                onPress={() => setReading("terms")}
              />
              <Button
                secondary
                title="Privacy Policy"
                icon="fileText"
                style={s.doc}
                onPress={() => setReading("privacy")}
              />
            </View>
            <View style={s.row}>
              <View style={{ flex: 1 }}>
                <Text style={s.rowTitle}>Usage analytics</Text>
                <Text style={shared.small}>
                  Count which features I use — never what I write — to help
                  improve Orbyn. Change it any time in Settings → Privacy.
                </Text>
              </View>
              <Switch
                value={analytics}
                trackColor={{ true: colors.accent }}
                accessibilityLabel="Usage analytics"
                onValueChange={setAnalytics}
              />
            </View>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: agreed }}
              onPress={() => setAgreed(!agreed)}
              style={s.agree}
            >
              <View style={[s.box, agreed && s.boxOn]}>
                {agreed && <Icon name="check" size={14} color={colors.white} />}
              </View>
              <Text style={s.agreeText}>
                I&apos;m {MINIMUM_AGE} or older and I agree to the Terms of
                Service and Privacy Policy (version {legal.terms_version}).
              </Text>
            </Pressable>
            <ErrorBanner error={error} />
            <Button
              title={busy ? "One moment…" : "Agree and continue"}
              icon={busy ? undefined : "arrowRight"}
              disabled={busy || !agreed}
              onPress={() => void accept()}
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
      <LegalSheet doc={reading} onClose={() => setReading(null)} />
    </>
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
      fontSize: 34,
      lineHeight: 40,
      letterSpacing: -1.2,
      color: colors.text,
    },
    intro: { marginBottom: 22 },
    docs: { flexDirection: "row", gap: 10, marginBottom: 18 },
    doc: { flex: 1, marginBottom: 0 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      padding: 14,
      borderRadius: 16,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      marginBottom: 16,
    },
    rowTitle: {
      fontFamily: fonts.semibold,
      fontSize: 15,
      color: colors.text,
      marginBottom: 2,
    },
    agree: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 10,
      marginBottom: 18,
    },
    box: {
      width: 22,
      height: 22,
      borderRadius: 7,
      borderWidth: 1.5,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 1,
    },
    boxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    agreeText: {
      flex: 1,
      fontFamily: fonts.regular,
      fontSize: 14,
      lineHeight: 21,
      color: colors.text,
    },
    gap: { marginTop: 12 },
  }),
);
