import React, { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { Pressable } from "../motion";
import { MAX_ALERT_MINUTES, type AttendeeStatus } from "@orbyn/core";
import { Button } from "./Button";
import { Chip, ChipRow } from "./Chip";
import { NumberInput } from "./Field";
import { Icon } from "./Icon";
import { Pill, type PillTone } from "./Pill";
import { SmallAction } from "./SmallAction";
import { minutesLabel, parseMinutes } from "../lib/planning";
import { colors, fonts, themed } from "../theme";
import { shared } from "../styles";

/** Quick picks for a new alert, in minutes before. */
const ALERT_PRESETS = [0, 5, 10, 15, 30, 60, 1440];
const MAX_ALERTS = 5;
const MAX_PEOPLE = 50;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** "At the time", "10 min before", "1 h before", "2 days before". */
export function alertLabel(minutes: number) {
  if (minutes === 0) return "At the time";
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return `${days} day${days === 1 ? "" : "s"} before`;
  }
  if (minutes % 60 === 0) return `${minutes / 60} h before`;
  if (minutes < 60) return `${minutes} min before`;
  return `${minutesLabel(minutes)} before`;
}

/**
 * An item's alerts (up to five): each one removable, and "Add alert" with
 * quick picks or a custom number of minutes.
 */
export function AlertsField({
  alerts,
  disabled = false,
  onChange,
}: {
  alerts: number[];
  disabled?: boolean;
  onChange: (alerts: number[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [custom, setCustom] = useState<string | null>(null);
  const full = alerts.length >= MAX_ALERTS;
  const add = (minutes: number) => {
    onChange([...new Set([...alerts, minutes])].sort((a, b) => a - b));
    setAdding(false);
    setCustom(null);
  };
  const customMinutes = custom === null ? null : parseMinutes(custom);
  const customOk =
    customMinutes !== null &&
    customMinutes >= 0 &&
    customMinutes <= MAX_ALERT_MINUTES;
  return (
    <View>
      {alerts.length === 0 ? (
        <Text style={shared.small}>No alerts.</Text>
      ) : (
        <ChipRow label="Alerts">
          {alerts.map((m) => (
            <Chip
              key={m}
              label={`${alertLabel(m)}  ×`}
              accessibilityLabel={`${alertLabel(m)}. Remove`}
              selected={false}
              disabled={disabled}
              onPress={() => onChange(alerts.filter((x) => x !== m))}
            />
          ))}
        </ChipRow>
      )}
      {!disabled && !full && !adding && (
        <View style={s.gapTop}>
          <SmallAction
            label="Add alert"
            disabled={false}
            onPress={() => setAdding(true)}
          />
        </View>
      )}
      {full && !disabled && (
        <Text style={[shared.small, s.gapTop]}>Up to 5 alerts.</Text>
      )}
      {adding && (
        <View style={s.panel}>
          <ChipRow label="Add an alert">
            {ALERT_PRESETS.filter((p) => !alerts.includes(p)).map((p) => (
              <Chip
                key={p}
                label={alertLabel(p)}
                selected={false}
                onPress={() => add(p)}
              />
            ))}
            <Chip
              label="Custom"
              selected={custom !== null}
              onPress={() => setCustom("")}
            />
          </ChipRow>
          {custom !== null && (
            <View style={[s.row, s.gapTop]}>
              <NumberInput
                value={custom}
                onChangeText={setCustom}
                suffix="minutes before"
                accessibilityLabel="Minutes before for the alert"
              />
            </View>
          )}
          <View style={[s.row, s.gapTop]}>
            {custom !== null && (
              <SmallAction
                label="Add"
                disabled={!customOk}
                onPress={() => customMinutes !== null && add(customMinutes)}
              />
            )}
            <SmallAction
              label="Cancel"
              disabled={false}
              onPress={() => {
                setAdding(false);
                setCustom(null);
              }}
            />
          </View>
        </View>
      )}
    </View>
  );
}

/** Colour swatches with "none" first, for an item's colour on the calendar. */
export function ColorField({
  value,
  choices,
  disabled = false,
  onChange,
}: {
  value: string | null;
  choices: string[];
  disabled?: boolean;
  onChange: (color: string | null) => void;
}) {
  const same = (c: string) => value?.toLowerCase() === c.toLowerCase();
  return (
    <View
      style={s.swatches}
      accessibilityRole="radiogroup"
      accessibilityLabel="Colour on the calendar"
    >
      <Pressable
        accessibilityRole="radio"
        accessibilityLabel="No colour of its own"
        accessibilityState={{ checked: !value, disabled }}
        disabled={disabled}
        hitSlop={4}
        onPress={() => onChange(null)}
        style={[s.swatch, s.none, !value && s.noneOn]}
      >
        <Icon name="x" size={14} color={colors.muted} />
      </Pressable>
      {choices.map((c, n) => (
        <Pressable
          key={c}
          accessibilityRole="radio"
          accessibilityLabel={`Colour ${n + 1} of ${choices.length}`}
          accessibilityState={{ checked: same(c), disabled }}
          disabled={disabled}
          hitSlop={4}
          onPress={() => onChange(c)}
          style={[s.swatch, { backgroundColor: c }]}
        >
          {same(c) && (
            <Icon name="check" size={14} color={colors.white} strokeWidth={3} />
          )}
        </Pressable>
      ))}
    </View>
  );
}

export type Invitee = { email: string; name?: string };

const RSVP: Record<AttendeeStatus, { label: string; tone: PillTone }> = {
  needs_action: { label: "No reply yet", tone: "muted" },
  accepted: { label: "Going", tone: "accent" },
  declined: { label: "Not going", tone: "danger" },
  tentative: { label: "Maybe", tone: "warning" },
};

/**
 * People invited to an event by email, with their answers once saved, and a
 * form to invite someone else. Saving sends the whole list.
 */
export function InviteesField({
  people,
  statuses,
  disabled = false,
  onChange,
}: {
  people: Invitee[];
  /** Answers by email, from the saved event. */
  statuses: Map<string, AttendeeStatus>;
  disabled?: boolean;
  onChange: (people: Invitee[]) => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [problem, setProblem] = useState("");
  const add = () => {
    const address = email.trim().toLowerCase();
    if (!EMAIL.test(address))
      return setProblem("That doesn’t look like an email address.");
    if (people.some((p) => p.email.toLowerCase() === address))
      return setProblem("They’re already invited.");
    if (people.length >= MAX_PEOPLE) return setProblem("Up to 50 people.");
    onChange([
      ...people,
      { email: address, ...(name.trim() ? { name: name.trim() } : {}) },
    ]);
    setEmail("");
    setName("");
    setProblem("");
  };
  return (
    <View>
      {people.length === 0 && (
        <Text style={shared.small}>Nobody invited yet.</Text>
      )}
      {people.map((p, n) => {
        const status = statuses.get(p.email.toLowerCase());
        const rsvp = status ? RSVP[status] : null;
        return (
          <View key={p.email} style={[s.person, n > 0 && s.divider]}>
            <View style={{ flex: 1 }}>
              <Text style={s.personName} numberOfLines={1}>
                {p.name || p.email}
              </Text>
              {!!p.name && (
                <Text style={shared.small} numberOfLines={1}>
                  {p.email}
                </Text>
              )}
            </View>
            <Pill label={rsvp ? rsvp.label : "New"} tone={rsvp?.tone} />
            {!disabled && (
              <SmallAction
                label="Remove"
                disabled={false}
                onPress={() =>
                  onChange(people.filter((x) => x.email !== p.email))
                }
              />
            )}
          </View>
        );
      })}
      {!disabled && (
        <View style={s.invite}>
          <TextInput
            style={shared.input}
            value={email}
            onChangeText={(text) => {
              setEmail(text);
              setProblem("");
            }}
            placeholder="name@example.com"
            placeholderTextColor={colors.faint}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={254}
            accessibilityLabel="Email address to invite"
          />
          <TextInput
            style={[shared.input, s.gapTop]}
            value={name}
            onChangeText={setName}
            placeholder="Their name (optional)"
            placeholderTextColor={colors.faint}
            maxLength={120}
            accessibilityLabel="Their name, optional"
          />
          {!!problem && (
            <Text style={[shared.small, s.problem]} accessibilityRole="alert">
              {problem}
            </Text>
          )}
          <Button
            secondary
            title="Invite"
            icon="userPlus"
            disabled={!email.trim()}
            style={s.inviteButton}
            onPress={add}
          />
          <Text style={shared.small}>
            They get an email invitation with a link to answer; no account
            needed.
          </Text>
        </View>
      )}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    gapTop: { marginTop: 10 },
    row: { flexDirection: "row", alignItems: "center", gap: 10 },
    panel: {
      marginTop: 10,
      padding: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    swatches: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    swatch: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: "center",
      justifyContent: "center",
    },
    none: {
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    noneOn: { borderColor: colors.accent, borderWidth: 2 },
    person: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingVertical: 8,
    },
    divider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    personName: {
      fontFamily: fonts.medium,
      fontSize: 15,
      color: colors.text,
    },
    invite: { marginTop: 10 },
    problem: { color: colors.danger, marginTop: 8 },
    inviteButton: { marginTop: 10 },
  }),
);
