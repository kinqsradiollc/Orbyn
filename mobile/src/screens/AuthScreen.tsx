import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Brand } from "../components/Brand";
import { Button } from "../components/Button";
import { ErrorBanner } from "../components/ErrorBanner";
import type { SignInInput } from "../hooks/usePlanner";
import { FadeIn, animateLayout } from "../motion";
import { motion } from "@orbyn/core";
import { colors, fonts } from "../theme";
import { shared } from "../styles";

export function AuthScreen({
  busy,
  error,
  act,
  signIn,
  clearError,
}: {
  busy: boolean;
  error: string;
  act: (fn: () => Promise<void>) => Promise<void>;
  signIn: (input: SignInInput) => Promise<void>;
  clearError: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [register, setRegister] = useState(true);
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
          </FadeIn>
          <FadeIn index={6} duration={motion.slow}>
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
              disabled={busy}
              onPress={() =>
                act(async () => {
                  await signIn({ email, password, name, register });
                  setPassword("");
                })
              }
            />
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
          </FadeIn>
        </View>
      </ScrollView>
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

const s = StyleSheet.create({
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
  field: { marginBottom: 16 },
  switch: { alignItems: "center", paddingVertical: 12 },
  switchText: { fontFamily: fonts.regular, fontSize: 14, color: colors.muted },
  switchLink: { fontFamily: fonts.semibold, color: colors.accent },
});
