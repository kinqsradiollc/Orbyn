import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { Switch } from "../../components/Switch";
import type { LegalDoc, PrivacyView } from "@orbyn/core";
import { Button } from "../../components/Button";
import { ErrorBanner } from "../../components/ErrorBanner";
import { LegalSheet, SecuritySheet } from "../../components/LegalSheet";
import { client } from "../../lib/api";
import { confirmAction } from "../../lib/confirm";
import { colors, fonts, themed } from "../../theme";
import { shared } from "../../styles";
import { SettingsSection } from "./SettingsSection";
import { errorText } from "../../lib/errors";

const when = (iso: string) =>
  new Date(iso).toLocaleString([], {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

/**
 * Settings → Privacy, as on the desktop: what you agreed to, the usage
 * analytics choice, your consent history, and deleting your account.
 * Exporting your data lives in Import & export.
 */
export function PrivacySection({
  email,
  busy,
  act,
  onDeleted,
}: {
  email: string;
  busy: boolean;
  act: (fn: () => Promise<void>) => Promise<void>;
  onDeleted: () => void;
}) {
  return (
    <PrivacyBody
      key={email}
      email={email}
      busy={busy}
      act={act}
      onDeleted={onDeleted}
    />
  );
}

function PrivacyBody({
  email,
  busy,
  act,
  onDeleted,
}: {
  email: string;
  busy: boolean;
  act: (fn: () => Promise<void>) => Promise<void>;
  onDeleted: () => void;
}) {
  const [view, setView] = useState<PrivacyView | null>(null);
  const [reading, setReading] = useState<LegalDoc | null>(null);
  const [security, setSecurity] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [allHistory, setAllHistory] = useState(false);
  const mounted = useRef(false);
  const mutation = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    client
      .privacy()
      .then((v) => alive && setView(v))
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [retry]);

  const remove = () =>
    confirmAction(
      "Delete your account for good?",
      "Everything only you can see is deleted. Teams you own pass to another member. This can't be undone.",
      "Delete",
      () =>
        void act(async () => {
          if (!mounted.current || mutation.current) return;
          mutation.current = true;
          setError("");
          try {
            await client.deleteAccount({ password });
            if (mounted.current) onDeleted();
          } catch (e) {
            if (mounted.current) setError(errorText(e));
          } finally {
            mutation.current = false;
          }
        }),
    );

  return (
    <>
      <SettingsSection title="Privacy">
        <Text style={shared.body}>
          {!view
            ? failed
              ? "Couldn't load privacy settings."
              : "Loading…"
            : view.terms_accepted_at
              ? `Terms and Privacy accepted · ${view.terms_version} · ${when(view.terms_accepted_at)}`
              : "You haven't agreed to the current terms yet."}
        </Text>
        {failed && (
          <Button
            secondary
            title="Retry privacy settings"
            onPress={() => setRetry((value) => value + 1)}
            disabled={busy}
          />
        )}
        <View style={s.docs}>
          <Button
            secondary
            title="Terms"
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
        <Button
          secondary
          title="Security and data"
          icon="shieldCheck"
          onPress={() => setSecurity(true)}
        />

        <View style={s.row}>
          <View style={{ flex: 1 }}>
            <Text style={s.rowTitle}>Usage analytics</Text>
            <Text style={shared.small}>
              Counts feature use, never your words. Turning off clears counts;
              security logs remain for 7 days.
            </Text>
          </View>
          <Switch
            value={!!view && !view.analytics_opt_out}
            disabled={!view || busy || failed}
            trackColor={{ true: colors.accent }}
            accessibilityLabel="Usage analytics"
            onValueChange={(on) =>
              void act(async () => {
                if (mutation.current) return;
                mutation.current = true;
                try {
                  const next = await client.setPrivacy({
                    analytics_opt_out: !on,
                  });
                  if (mounted.current) setView(next);
                } finally {
                  mutation.current = false;
                }
              })
            }
          />
        </View>

        {view && view.history.length > 0 && (
          <View style={s.history}>
            <Text style={shared.label}>Consent history</Text>
            {(allHistory ? view.history : view.history.slice(0, 8)).map(
              (h, i) => (
                <View key={i} style={s.historyRow}>
                  <Text style={[shared.small, { flex: 1 }]}>
                    {h.kind === "terms"
                      ? `Agreed to the terms (${h.version})`
                      : h.granted
                        ? "Turned usage analytics on"
                        : "Turned usage analytics off"}
                  </Text>
                  <Text style={shared.small}>{when(h.at)}</Text>
                </View>
              ),
            )}
            {view.history.length > 8 && (
              <Button
                secondary
                title={allHistory ? "Show recent consent" : "Show all consent"}
                onPress={() => setAllHistory((value) => !value)}
              />
            )}
          </View>
        )}
        <Text style={[shared.small, { marginTop: 12 }]}>
          Export your data in Import & export.
        </Text>
      </SettingsSection>

      <SettingsSection title="Delete my account">
        <Text style={shared.body}>
          Deletes {email} and everything only you can see, for good; shared work
          stays with its team.
        </Text>
        <Text style={[shared.label, { marginTop: 12 }]}>
          Your password, to confirm
        </Text>
        <TextInput
          style={[shared.input, { marginTop: 6 }]}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          autoCapitalize="none"
          autoComplete="current-password"
          textContentType="password"
          editable={!busy}
          accessibilityLabel="Your password"
        />
        <ErrorBanner error={error} />
        <Button
          destructive
          title="Delete my account"
          icon="trash"
          disabled={busy || !password}
          style={{ marginTop: 12, marginBottom: 0 }}
          onPress={remove}
        />
      </SettingsSection>
      <LegalSheet doc={reading} onClose={() => setReading(null)} />
      <SecuritySheet visible={security} onClose={() => setSecurity(false)} />
    </>
  );
}

const s = themed(() =>
  StyleSheet.create({
    docs: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 12 },
    doc: { flexGrow: 1, flexBasis: 120, marginBottom: 0 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      marginTop: 16,
    },
    rowTitle: {
      fontFamily: fonts.semibold,
      fontSize: 15,
      color: colors.text,
      marginBottom: 2,
    },
    history: { marginTop: 16, gap: 6 },
    historyRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  }),
);
