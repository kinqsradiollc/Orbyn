import React, { useEffect, useState } from "react";
import {
  Alert,
  Linking,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { RESERVED_HANDLES, type Profile } from "@orbyn/core";
import { Button } from "../../components/Button";
import { ErrorBanner } from "../../components/ErrorBanner";
import { Field } from "../../components/Field";
import { SmallAction } from "../../components/SmallAction";
import { client, webOrigin } from "../../lib/api";
import { shareText } from "../../lib/planning";
import { useRun } from "../../hooks/useRun";
import { animateLayout } from "../../motion";
import { colors, fonts, themed } from "../../theme";
import { shared } from "../../styles";
import { SLUG } from "./helpers";
import { bookingStyles as bs } from "./ui";

const MAX_BIO = 300;

/** What's wrong with a handle, or null when it's fine. */
function handleProblem(handle: string) {
  if (handle.length < 3 || handle.length > 40) return "Use 3 to 40 characters.";
  if (!SLUG.test(handle))
    return "Use lowercase letters and numbers, with single dashes between words.";
  if (RESERVED_HANDLES.includes(handle))
    return "That name is reserved. Try another.";
  return null;
}

/**
 * Your public profile page (/u/<handle>): a short bio and the booking pages
 * you own or host. Pick a handle to turn it on; clear it to take it down.
 */
export function ProfileCard() {
  const { busy, error, setError, run } = useRun();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [handle, setHandle] = useState("");
  const [bio, setBio] = useState("");
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let alive = true;
    client
      .getProfile()
      .then((p) => {
        if (!alive) return;
        setProfile(p);
        setHandle(p.handle ?? "");
        setBio(p.bio ?? "");
      })
      // Older servers have no profile pages; the card stays hidden.
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  if (!profile) return null;

  const clean = handle.trim().toLowerCase();
  const problem = clean ? handleProblem(clean) : null;
  const changed =
    clean !== (profile.handle ?? "") || bio.trim() !== profile.bio;
  const take = (p: Profile) => {
    animateLayout();
    setProfile(p);
    setHandle(p.handle ?? "");
    setBio(p.bio ?? "");
  };
  const save = () =>
    run(async () => {
      take(
        await client.updateProfile({
          // An empty handle keeps the page off; the bio is kept either way.
          ...(clean ? { handle: clean } : {}),
          bio: bio.trim(),
        }),
      );
      setEditing(false);
    });
  const remove = () =>
    Alert.alert(
      "Take your profile page down?",
      "Its link stops working. Your booking pages stay as they are.",
      [
        { text: "Keep it", style: "cancel" },
        {
          text: "Take down",
          style: "destructive",
          onPress: () =>
            void run(async () => {
              take(await client.updateProfile({ handle: null }));
              setEditing(false);
            }),
        },
      ],
    );

  return (
    <View style={[shared.card, s.card]}>
      <ErrorBanner error={error} onDismiss={() => setError("")} />
      <Text style={shared.sectionTitle}>Your profile page</Text>
      <Text style={[shared.small, s.line]}>
        One link with a short bio and every booking page you host.
      </Text>
      {profile.url ? (
        <>
          <Text selectable style={s.link}>
            {profile.url}
          </Text>
          {!!profile.bio && !editing && (
            <Text style={[shared.body, s.bio]}>{profile.bio}</Text>
          )}
          <View style={s.actions}>
            <SmallAction
              label="Share link"
              disabled={false}
              onPress={() => void shareText(profile.url!)}
            />
            <SmallAction
              label="Open"
              disabled={false}
              onPress={() =>
                void Linking.openURL(profile.url!).catch(() =>
                  setError("That link couldn’t be opened."),
                )
              }
            />
            {!editing && (
              <SmallAction
                label="Edit"
                disabled={false}
                onPress={() => {
                  animateLayout();
                  setEditing(true);
                }}
              />
            )}
          </View>
        </>
      ) : (
        !editing && (
          <Button
            secondary
            title="Make my profile page"
            icon="plus"
            style={s.start}
            onPress={() => {
              animateLayout();
              setEditing(true);
            }}
          />
        )
      )}
      {editing && (
        <View style={s.form}>
          <Field label="Handle" hint={`${webOrigin}/u/${clean || "your-name"}`}>
            <TextInput
              style={shared.input}
              value={handle}
              onChangeText={(t) => setHandle(t.toLowerCase())}
              maxLength={40}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="your-name"
              placeholderTextColor={colors.faint}
              accessibilityLabel="Profile handle, lowercase letters, numbers and dashes"
            />
            {!!problem && (
              <Text style={[shared.small, bs.warn, bs.top]}>{problem}</Text>
            )}
          </Field>
          <Field label="Bio (optional)" hint={`${bio.length}/${MAX_BIO}`}>
            <TextInput
              style={[shared.input, bs.multiline]}
              value={bio}
              onChangeText={setBio}
              maxLength={MAX_BIO}
              multiline
              textAlignVertical="top"
              placeholder="What people can book you for"
              placeholderTextColor={colors.faint}
              accessibilityLabel="Bio"
            />
          </Field>
          <Button
            title={busy ? "Saving…" : "Save profile"}
            icon="check"
            disabled={
              busy ||
              !!problem ||
              !changed ||
              (!clean && !profile.handle && !bio.trim())
            }
            onPress={() => void save()}
          />
          <View style={s.actions}>
            <SmallAction
              label="Cancel"
              disabled={busy}
              onPress={() => {
                animateLayout();
                setHandle(profile.handle ?? "");
                setBio(profile.bio ?? "");
                setEditing(false);
              }}
            />
            {!!profile.handle && (
              <SmallAction
                destructive
                label="Take page down"
                disabled={busy}
                onPress={remove}
              />
            )}
          </View>
        </View>
      )}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    card: { marginBottom: 18 },
    line: { marginTop: 4 },
    link: {
      fontFamily: fonts.medium,
      fontSize: 14,
      color: colors.accent,
      marginTop: 10,
    },
    bio: { marginTop: 8 },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
    start: { marginTop: 12, marginBottom: 0 },
    form: { marginTop: 14 },
  }),
);
