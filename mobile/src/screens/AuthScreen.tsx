import React, { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { client } from "../lib/api";
import { Brand } from "../components/Brand";
import { Button } from "../components/Button";
import { ErrorBanner } from "../components/ErrorBanner";
import { Icon } from "../components/Icon";
import { LegalSheet } from "../components/LegalSheet";
import type { SignInInput } from "../hooks/usePlanner";
import { FadeIn, animateLayout, Pressable } from "../motion";
import { MINIMUM_AGE, motion, type LegalDoc } from "@orbyn/core";
import { colors, fonts, themed } from "../theme";
import { shared } from "../styles";

export function AuthScreen({
  busy,
  error,
  act,
  signIn,
  clearError,
  twoFactorRequired,
}: {
  busy: boolean;
  error: string;
  act: (fn: () => Promise<void>) => Promise<void>;
  signIn: (input: SignInInput) => Promise<boolean>;
  clearError: () => void;
  twoFactorRequired?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [register, setRegister] = useState(true);
  const [notice, setNotice] = useState("");
  const [code, setCode] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [termsVersion, setTermsVersion] = useState("");
  const [reading, setReading] = useState<LegalDoc | null>(null);
  useEffect(() => {
    let alive = true;
    client
      .legal()
      .then((l) => alive && setTermsVersion(l.terms_version))
      .catch(() => {
        // The account is still made; the app asks once signed in.
      });
    return () => {
      alive = false;
    };
  }, []);
  const link = (doc: LegalDoc, label: string) => (
    <Text
      style={s.link}
      accessibilityRole="link"
      onPress={() => setReading(doc)}
    >
      {label}
    </Text>
  );
  return (
    <KeyboardAvoidingView
      style={s.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
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
      >
        <View style={s.column}>
          {/* Logo, headline, form and actions rise in one after another. */}
          <FadeIn index={0} duration={motion.slow}>
            <Brand size={30} />
          </FadeIn>
          <FadeIn index={2} duration={motion.slow}>
            <Text style={[shared.eyebrow, s.eyebrow]}>
              A LITTLE CLARITY. A LOT MORE POSSIBILITY.
            </Text>
            <Text style={s.hero}>
              {register ? "A fresh start\nawaits." : "Welcome\nback."}
            </Text>
            <Text style={[shared.subtitle, s.intro]}>
              {register
                ? "Create your account and find your flow."
                : "Your plans are right where you left them."}
            </Text>
          </FadeIn>
          <FadeIn index={4} duration={motion.slow}>
            {register && (
              <Field label="Your name">
                <TextInput
                  style={shared.input}
                  placeholder="Alex Morgan"
                  placeholderTextColor={colors.faint}
                  value={name}
                  onChangeText={setName}
                  maxLength={80}
                  autoComplete="name"
                  textContentType="name"
                  returnKeyType="next"
                />
              </Field>
            )}
            <Field label="Email address">
              <TextInput
                style={shared.input}
                placeholder="you@example.com"
                placeholderTextColor={colors.faint}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                textContentType="emailAddress"
                returnKeyType="next"
              />
            </Field>
            <Field label="Password">
              <TextInput
                style={shared.input}
                placeholder="At least 10 characters"
                placeholderTextColor={colors.faint}
                secureTextEntry
                value={password}
                onChangeText={setPassword}
                maxLength={128}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete={register ? "new-password" : "current-password"}
                textContentType={register ? "newPassword" : "password"}
              />
            </Field>
            {!register && twoFactorRequired && (
              <Field label="Authenticator code">
                <TextInput
                  style={shared.input}
                  placeholder="123456 or a recovery code"
                  placeholderTextColor={colors.faint}
                  value={code}
                  onChangeText={setCode}
                  keyboardType="number-pad"
                  autoCapitalize="none"
                  autoComplete="one-time-code"
                  textContentType="oneTimeCode"
                  maxLength={20}
                />
              </Field>
            )}
          </FadeIn>
          <FadeIn index={6} duration={motion.slow}>
            {register && (
              <View style={s.consent}>
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: agreed }}
                  accessibilityLabel={`I'm ${MINIMUM_AGE} or older and I agree to the Terms of Service and Privacy Policy`}
                  hitSlop={8}
                  onPress={() => setAgreed(!agreed)}
                  style={[s.box, agreed && s.boxOn]}
                >
                  {agreed && (
                    <Icon name="check" size={14} color={colors.white} />
                  )}
                </Pressable>
                <Text style={s.consentText}>
                  I&apos;m {MINIMUM_AGE} or older and I agree to the{" "}
                  {link("terms", "Terms of Service")} and{" "}
                  {link("privacy", "Privacy Policy")}.
                </Text>
              </View>
            )}
            {register && (
              <Text style={s.fine}>
                Orbyn counts which features you use — never what you write — to
                keep it running and improve it. Turn that off any time in
                Settings → Privacy. No ads, no trackers, never sold.
              </Text>
            )}
            {!!notice && <Text style={s.notice}>{notice}</Text>}
            <ErrorBanner error={error} />
            <Button
              title={
                busy
                  ? "One moment…"
                  : register
                    ? "Create your space"
                    : "Sign in"
              }
              icon={busy ? undefined : "arrowRight"}
              disabled={busy || (register && !agreed)}
              onPress={() =>
                act(async () => {
                  const ok = await signIn({
                    email,
                    password,
                    name,
                    register,
                    code,
                    acceptTerms: register && agreed ? termsVersion : undefined,
                  });
                  if (ok) {
                    setPassword("");
                    setCode("");
                  }
                })
              }
            />
            {!register && (
              <Pressable
                accessibilityRole="button"
                style={s.forgot}
                disabled={busy}
                onPress={() =>
                  act(async () => {
                    clearError();
                    setNotice("");
                    await client.forgotPassword(email.trim());
                    setNotice(
                      "If an account uses that address, a link to reset your password is on its way.",
                    );
                  })
                }
              >
                <Text style={s.forgotText}>Forgot your password?</Text>
              </Pressable>
            )}
            <Pressable
              accessibilityRole="button"
              style={s.switch}
              onPress={() => {
                // The name field slides in or out with the mode switch.
                animateLayout();
                setRegister(!register);
                clearError();
              }}
            >
              <Text style={s.switchText}>
                {register ? "Already have an account? " : "New to Orbyn? "}
                <Text style={s.switchLink}>
                  {register ? "Sign in" : "Create an account"}
                </Text>
              </Text>
            </Pressable>
            {!register && (
              <Text style={[s.fine, s.center]}>
                By signing in, you agree to the{" "}
                {link("terms", "Terms of Service")} and{" "}
                {link("privacy", "Privacy Policy")}.
              </Text>
            )}
          </FadeIn>
        </View>
      </ScrollView>
      <LegalSheet doc={reading} onClose={() => setReading(null)} />
    </KeyboardAvoidingView>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View style={s.field}>
      <Text style={shared.label}>{label}</Text>
      {children}
    </View>
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
      fontSize: 36,
      lineHeight: 44,
      letterSpacing: -1.4,
      color: colors.text,
    },
    intro: { marginBottom: 28 },
    field: { marginBottom: 16 },
    notice: {
      fontFamily: fonts.regular,
      fontSize: 15,
      color: colors.muted,
      marginBottom: 12,
    },
    forgot: { alignItems: "center", paddingTop: 12 },
    forgotText: {
      fontFamily: fonts.semibold,
      fontSize: 15,
      color: colors.accent,
    },
    switch: { alignItems: "center", paddingVertical: 12 },
    switchText: {
      fontFamily: fonts.regular,
      fontSize: 15,
      color: colors.muted,
    },
    switchLink: { fontFamily: fonts.semibold, color: colors.accent },
    consent: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 10,
      marginBottom: 8,
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
    consentText: {
      flex: 1,
      fontFamily: fonts.regular,
      fontSize: 15,
      lineHeight: 21,
      color: colors.text,
    },
    link: { fontFamily: fonts.semibold, color: colors.accent },
    fine: {
      fontFamily: fonts.regular,
      fontSize: 13,
      lineHeight: 18,
      color: colors.muted,
      marginBottom: 16,
    },
    center: { textAlign: "center", marginTop: 4, marginBottom: 0 },
  }),
);
