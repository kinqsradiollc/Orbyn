import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
} from "react-native";
import { Button } from "../components/Button";
import { ErrorBanner } from "../components/ErrorBanner";
import type { SignInInput } from "../hooks/usePlanner";
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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [register, setRegister] = useState(true);
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={s.auth}>
        <Text style={shared.logo}>◎ orbyn</Text>
        <Text style={shared.eyebrow}>
          A LITTLE CLARITY. A LOT MORE POSSIBILITY.
        </Text>
        <Text style={s.hero}>Your life.{"\n"}In a better orbit.</Text>
        <Text style={shared.subtitle}>
          {register
            ? "Create your space and make room for what matters."
            : "Welcome back. Your plans are right here."}
        </Text>
        {register && (
          <TextInput
            style={shared.input}
            placeholder="Your name"
            value={name}
            onChangeText={setName}
            maxLength={80}
            autoComplete="name"
          />
        )}
        <TextInput
          style={shared.input}
          placeholder="Email address"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
        />
        <TextInput
          style={shared.input}
          placeholder="Password (at least 10 characters)"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          maxLength={128}
          autoComplete={register ? "new-password" : "current-password"}
        />
        <ErrorBanner error={error} />
        <Button
          title={
            busy ? "One moment…" : register ? "Create your space" : "Sign in"
          }
          disabled={busy}
          onPress={() =>
            act(async () => {
              await signIn({ email, password, name, register });
              setPassword("");
            })
          }
        />
        <Button
          secondary
          title={
            register
              ? "Already have an account? Sign in"
              : "New here? Create an account"
          }
          onPress={() => {
            setRegister(!register);
            clearError();
          }}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  auth: {
    flexGrow: 1,
    justifyContent: "center",
    padding: 30,
    backgroundColor: "#edf1e5",
  },
  hero: {
    fontSize: 43,
    fontWeight: "500",
    letterSpacing: -1.6,
    color: "#304935",
    marginVertical: 20,
  },
});
