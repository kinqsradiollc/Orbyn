import React, { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Switch } from "../components/Switch";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  MINIMUM_AGE,
  type LegalDoc,
  type LegalSummary,
  type User,
} from "@orbyn/core";
import { Brand } from "../components/Brand";
import { Button } from "../components/Button";
import { ErrorBanner } from "../components/ErrorBanner";
import { Icon } from "../components/Icon";
import { LegalSheet } from "../components/LegalSheet";
import { session } from "../lib/session";
import { client } from "../lib/api";
import { Pressable } from "../motion";
import { colors, fonts, radii, themed } from "../theme";
import { shared } from "../styles";
import { errorText } from "../lib/errors";

/**
 * Held before the app when you haven't agreed to the current Terms and
 * Privacy Policy — the same gate as the desktop, with the usage-analytics
 * choice shown up front.
 */
export function ConsentGateScreen(
  props: Parameters<typeof ConsentGateBody>[0],
) {
  return (
    <ConsentGateBody
      key={`${props.user.id}:${props.legal.terms_version}:${session.token}`}
      {...props}
    />
  );
}
function ConsentGateBody({
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

  const owner = session.token;
  const latest = useRef({
    owner,
    userId: user.id,
    version: legal.terms_version,
  });
  latest.current = { owner, userId: user.id, version: legal.terms_version };
  const mounted = useRef(true);
  const pending = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const accept = async () => {
    const version = legal.terms_version;
    const current = () =>
      mounted.current &&
      session.token === owner &&
      latest.current.owner === owner &&
      latest.current.userId === user.id &&
      latest.current.version === version;
    if (busy || pending.current || !agreed || !current()) return;
    pending.current = true;
    try {
      await act(async () => {
        setError("");
        try {
          await client.acceptTerms(version);
          if (!current()) return;
          if (analytics === !!user.analytics_opt_out)
            await client.setPrivacy({ analytics_opt_out: !analytics });
          if (current()) onAccepted();
        } catch (e) {
          if (current()) setError(errorText(e));
        }
      });
    } finally {
      pending.current = false;
    }
  };

  return (
    <>
      <ScrollView
        contentContainerStyle={[
          s.scroll,
          {
            paddingTop: insets.top + 24,
            paddingBottom: insets.bottom + 24,
            paddingLeft: insets.left + 16,
            paddingRight: insets.right + 16,
          },
        ]}
        style={s.screen}
      >
        <View style={s.column}>
          <View>
            <Brand size={30} />
          </View>
          <View>
            <Text style={[shared.eyebrow, s.eyebrow]}>
              {updated ? "WE'VE UPDATED OUR TERMS" : "BEFORE YOU CONTINUE"}
            </Text>
            <Text style={s.hero}>Review terms</Text>
            <Text style={[shared.subtitle, s.intro]}>
              {updated
                ? "Our terms or privacy policy changed. Review them before continuing."
                : "Review our terms and privacy policy before continuing."}
            </Text>
          </View>
          <View>
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
                  Count feature use to improve Orbyn. Never your content.
                </Text>
              </View>
              <Switch
                disabled={busy}
                value={analytics}
                trackColor={{ true: colors.accent }}
                accessibilityLabel="Usage analytics"
                onValueChange={setAnalytics}
              />
            </View>
            <Pressable
              accessibilityRole="checkbox"
              disabled={busy}
              accessibilityState={{ checked: agreed, disabled: busy }}
              onPress={() => setAgreed(!agreed)}
              style={s.agree}
            >
              <View style={[s.box, agreed && s.boxOn]}>
                {agreed && (
                  <Icon name="check" size={14} color={colors.onAccent} />
                )}
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
          </View>
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
    eyebrow: { marginTop: 20 },
    hero: {
      fontFamily: fonts.display,
      fontSize: 20,
      lineHeight: 28,
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
      borderRadius: radii.card,
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
      borderRadius: radii.check,
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
      fontSize: 15,
      lineHeight: 21,
      color: colors.text,
    },
    gap: { marginTop: 12 },
  }),
);
