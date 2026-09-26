import React, { useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  defaultStarter,
  FIRST_RUN_PURPOSES,
  PURPOSE_LABELS,
  startersFor,
  type FirstRunPurpose,
  type FirstRunResult,
  type StarterId,
  type User,
} from "@orbyn/core";
import { Button } from "../components/Button";
import { Icon, type IconName } from "../components/Icon";
import { Sheet, sheetStyles } from "../components/Sheet";
import { client } from "../lib/api";
import { errorText } from "../lib/errors";
import { shared } from "../styles";
import { colors, fonts, radii, themed } from "../theme";

const PURPOSE_ICONS: Record<FirstRunPurpose, IconName> = {
  study: "graduationCap",
  team: "users",
  personal: "target",
};

/**
 * The guided first run on the phone (DSN-02), the same three steps as the
 * web: what Orbyn is for (Study, Team or Personal), a calendar to show
 * alongside if you like, and a starter — a small project with a brief page
 * that links to its other pages. "Not now" skips it for good.
 */
export function FirstRunSheet({
  visible,
  user,
  onDone,
}: {
  visible: boolean;
  user: User;
  /** Finished or skipped; the result opens the brief when there is one. */
  onDone: (user: User, made: FirstRunResult | null) => void;
}) {
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [purpose, setPurpose] = useState<FirstRunPurpose>("study");
  const [starter, setStarter] = useState<StarterId>("term");
  const [calendarUrl, setCalendarUrl] = useState("");
  const [calendarNote, setCalendarNote] = useState("");
  const [teamName, setTeamName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const skip = () => run(async () => onDone(await client.skipFirstRun(), null));
  const connect = () => {
    const url = calendarUrl.trim();
    if (!url) return setStep(2);
    void run(async () => {
      await client.createCalendarSubscription({ url, name: "My calendar" });
      setCalendarNote("Connected. Its events show on your calendar.");
      setStep(2);
    });
  };
  const finish = () =>
    run(async () => {
      const made = await client.finishFirstRun({
        purpose,
        starter,
        ...(starter === "sprint" && teamName.trim()
          ? { team_name: teamName.trim() }
          : {}),
      });
      onDone(made.user, made);
    });

  const first = user.name.split(" ")[0];
  const choice = (
    key: string,
    on: boolean,
    icon: IconName,
    name: string,
    blurb: string,
    onPress: () => void,
  ) => (
    <Pressable
      key={key}
      accessibilityRole="radio"
      accessibilityState={{ checked: on }}
      accessibilityLabel={`${name}. ${blurb}`}
      onPress={onPress}
      style={({ pressed }) => [
        shared.card,
        s.choice,
        on && s.choiceOn,
        pressed && { opacity: 0.7 },
      ]}
    >
      <Icon name={icon} size={18} color={on ? colors.accent : colors.muted} />
      <View style={s.choiceText}>
        <Text style={s.choiceName}>{name}</Text>
        <Text style={s.blurb}>{blurb}</Text>
      </View>
    </Pressable>
  );

  return (
    <Sheet
      visible={visible}
      title="Welcome"
      hideClose
      onClose={() => void skip()}
    >
      <ScrollView
        contentContainerStyle={sheetStyles.body}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        <View style={[sheetStyles.column, s.column]}>
          <Text style={s.step} accessibilityLiveRegion="polite">
            Step {step + 1} of 3
          </Text>
          {step === 0 && (
            <>
              <Text style={s.heading} accessibilityRole="header">
                Welcome{first ? `, ${first}` : ""}. What's Orbyn for?
              </Text>
              <Text style={s.blurb}>
                Orbyn sets up a first project to match. Everything stays open to
                you, whichever you pick.
              </Text>
              <View accessibilityRole="radiogroup" style={s.choices}>
                {FIRST_RUN_PURPOSES.map((p) =>
                  choice(
                    p,
                    purpose === p,
                    PURPOSE_ICONS[p],
                    PURPOSE_LABELS[p].name,
                    PURPOSE_LABELS[p].blurb,
                    () => {
                      setPurpose(p);
                      setStarter(defaultStarter(p));
                    },
                  ),
                )}
              </View>
            </>
          )}
          {step === 1 && (
            <>
              <Text style={s.heading} accessibilityRole="header">
                Connect a calendar (optional)
              </Text>
              <Text style={s.blurb}>
                Paste the private address (ending .ics) of a calendar you
                already use, such as your timetable or Google Calendar, and its
                events show beside your plans. You can add more in Settings.
              </Text>
              <Text style={shared.label}>Calendar address</Text>
              <TextInput
                style={shared.input}
                value={calendarUrl}
                onChangeText={setCalendarUrl}
                placeholder="https://…/basic.ics"
                placeholderTextColor={colors.faint}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                accessibilityLabel="Calendar address"
              />
            </>
          )}
          {step === 2 && (
            <>
              <Text style={s.heading} accessibilityRole="header">
                Pick a starter
              </Text>
              {!!calendarNote && <Text style={s.ok}>{calendarNote}</Text>}
              <View accessibilityRole="radiogroup" style={s.choices}>
                {startersFor(purpose).map((st) =>
                  choice(
                    st.id,
                    starter === st.id,
                    "layoutTemplate",
                    st.name,
                    st.blurb,
                    () => setStarter(st.id),
                  ),
                )}
              </View>
              {starter === "sprint" && (
                <>
                  <Text style={shared.label}>The team's name</Text>
                  <TextInput
                    style={shared.input}
                    value={teamName}
                    maxLength={80}
                    onChangeText={setTeamName}
                    placeholder={`${first || "My"}'s team`}
                    placeholderTextColor={colors.faint}
                    accessibilityLabel="The team's name"
                  />
                </>
              )}
            </>
          )}
          {!!error && (
            <Text style={s.error} accessibilityRole="alert">
              {error}
            </Text>
          )}
          <View style={s.foot}>
            <Button
              secondary
              title="Not now"
              disabled={busy}
              style={s.footButton}
              onPress={() => void skip()}
            />
            {step > 0 && (
              <Button
                secondary
                title="Back"
                disabled={busy}
                style={s.footButton}
                onPress={() => setStep((n) => (n - 1) as 0 | 1)}
              />
            )}
            <Button
              title={
                step === 0
                  ? "Next"
                  : step === 1
                    ? calendarUrl.trim()
                      ? "Connect"
                      : "Skip this"
                    : starter === "none"
                      ? "Start"
                      : "Make it"
              }
              disabled={busy}
              style={s.footButton}
              onPress={() =>
                step === 0 ? setStep(1) : step === 1 ? connect() : void finish()
              }
            />
          </View>
        </View>
      </ScrollView>
    </Sheet>
  );
}

const s = themed(() =>
  StyleSheet.create({
    column: { gap: 12 },
    step: { fontFamily: fonts.medium, fontSize: 13, color: colors.muted },
    heading: { fontFamily: fonts.display, fontSize: 24, color: colors.text },
    blurb: {
      fontFamily: fonts.regular,
      fontSize: 13,
      lineHeight: 18,
      color: colors.textSoft,
    },
    choices: { gap: 8 },
    choice: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: 56,
      borderRadius: radii.card,
    },
    choiceOn: { borderColor: colors.accent, borderWidth: 2 },
    choiceText: { flex: 1, gap: 2 },
    choiceName: {
      fontFamily: fonts.semibold,
      fontSize: 15,
      color: colors.text,
    },
    ok: { fontFamily: fonts.regular, fontSize: 13, color: colors.accent },
    error: { fontFamily: fonts.regular, fontSize: 13, color: colors.danger },
    foot: { flexDirection: "row", gap: 8, marginTop: 8, flexWrap: "wrap" },
    footButton: { flexGrow: 1, marginTop: 0, marginBottom: 0 },
  }),
);
