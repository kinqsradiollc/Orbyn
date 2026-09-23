import React, { useEffect, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import {
  LEGAL_TITLES,
  type LegalAdminView,
  type LegalDoc,
  type LegalSettingsUpdate,
} from "@orbyn/core";
import { LegalSheet } from "../components/LegalSheet";
import { SmallAction } from "../components/SmallAction";
import { client } from "../lib/api";
import { confirmAction } from "../lib/confirm";
import { colors, fonts, themed } from "../theme";
import { shared } from "../styles";

type Act = (fn: () => Promise<void>) => Promise<void>;

const MISSING: Record<string, string> = {
  company: "who runs the service",
  contact_email: "a privacy contact",
  jurisdiction: "the governing law",
  processors: "the services that process data",
};

/**
 * Admin → System → Terms and privacy, as on the desktop: who runs the
 * service, the two documents, and publishing a new version so everyone is
 * asked to agree again.
 */
export function LegalCard({ act, busy }: { act: Act; busy: boolean }) {
  const [view, setView] = useState<LegalAdminView | null>(null);
  const [company, setCompany] = useState("");
  const [contact, setContact] = useState("");
  const [jurisdiction, setJurisdiction] = useState("");
  const [processors, setProcessors] = useState("");
  const [editing, setEditing] = useState<LegalDoc | null>(null);
  const [text, setText] = useState("");
  const [reading, setReading] = useState<LegalDoc | null>(null);
  const [note, setNote] = useState("");

  const adopt = (v: LegalAdminView) => {
    setView(v);
    setCompany(v.settings.company);
    setContact(v.settings.contact_email);
    setJurisdiction(v.settings.jurisdiction);
    setProcessors(v.settings.processors);
  };
  useEffect(() => {
    void act(async () => adopt(await client.adminLegal()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = (input: LegalSettingsUpdate, done: string) =>
    void act(async () => {
      setNote("");
      adopt(await client.updateLegal(input));
      setNote(done);
    });

  if (!view)
    return (
      <View style={[shared.card, s.flat]}>
        <Text style={s.title}>Terms and privacy</Text>
        <Text style={shared.small}>Loading…</Text>
      </View>
    );

  const field = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    extra: Partial<React.ComponentProps<typeof TextInput>> = {},
  ) => (
    <>
      <Text style={[shared.label, s.label]}>{label}</Text>
      <TextInput
        style={shared.input}
        value={value}
        onChangeText={onChange}
        placeholderTextColor={colors.faint}
        accessibilityLabel={label}
        {...extra}
      />
    </>
  );

  return (
    <View style={[shared.card, s.flat]}>
      <Text style={s.title}>Terms and privacy</Text>
      <Text style={shared.small}>
        {view.accepted_current} of {view.users} people agreed to the current
        version · {view.analytics_opted_out} turned usage analytics off.
      </Text>
      {view.missing.length > 0 && (
        <Text style={s.missing}>
          Still needed: {view.missing.map((m) => MISSING[m] ?? m).join(", ")}.
          Have both texts reviewed by a lawyer before launch.
        </Text>
      )}
      {field("Who runs the service", company, setCompany, {
        placeholder: "Example Ltd",
        maxLength: 160,
      })}
      {field("Privacy contact", contact, setContact, {
        placeholder: "privacy@example.com",
        keyboardType: "email-address",
        autoCapitalize: "none",
        maxLength: 254,
      })}
      {field("Governing law", jurisdiction, setJurisdiction, {
        placeholder: "England and Wales",
        maxLength: 160,
      })}
      {field(
        "Services that process data (one per line)",
        processors,
        setProcessors,
        {
          placeholder: "Hosting — Example Cloud",
          multiline: true,
          style: [shared.input, s.multiline],
          maxLength: 4000,
        },
      )}
      <View style={s.actions}>
        <SmallAction
          label="Save details"
          disabled={busy}
          onPress={() =>
            save(
              { company, contact_email: contact, jurisdiction, processors },
              "Saved.",
            )
          }
        />
      </View>

      {(["terms", "privacy"] as const).map((doc) => {
        const d = view.settings[doc];
        return (
          <View key={doc} style={s.doc}>
            <Text style={s.docTitle}>{LEGAL_TITLES[doc]}</Text>
            <Text style={shared.small}>
              Version {d.version} ·{" "}
              {d.body ? "your own text" : "Orbyn's starting text"}
            </Text>
            <View style={s.actions}>
              <SmallAction
                label="Read"
                disabled={false}
                onPress={() => setReading(doc)}
              />
              <SmallAction
                label={editing === doc ? "Close" : "Edit text"}
                disabled={false}
                onPress={() => {
                  if (editing === doc) return setEditing(null);
                  setEditing(doc);
                  setText(d.body ?? view.defaults[doc]);
                }}
              />
              <SmallAction
                label="Publish new version"
                disabled={busy}
                onPress={() =>
                  confirmAction(
                    `Publish a new ${LEGAL_TITLES[doc]}?`,
                    "Everyone will be asked to review it and agree again.",
                    "Publish",
                    () =>
                      save(
                        { publish: [doc] },
                        "Published. Everyone will be asked to agree.",
                      ),
                  )
                }
              />
            </View>
            {editing === doc && (
              <>
                <TextInput
                  style={[shared.input, s.editor]}
                  value={text}
                  onChangeText={setText}
                  multiline
                  maxLength={60000}
                  accessibilityLabel={`${LEGAL_TITLES[doc]} text`}
                />
                <View style={s.actions}>
                  <SmallAction
                    label="Save text"
                    disabled={busy || !text.trim()}
                    onPress={() =>
                      save(
                        doc === "terms"
                          ? { terms_body: text }
                          : { privacy_body: text },
                        "Text saved. Publish a new version to ask everyone.",
                      )
                    }
                  />
                  {!!d.body && (
                    <SmallAction
                      label="Use the starting text"
                      disabled={busy}
                      onPress={() => {
                        save(
                          doc === "terms"
                            ? { terms_body: null }
                            : { privacy_body: null },
                          "Back to Orbyn's starting text.",
                        );
                        setEditing(null);
                      }}
                    />
                  )}
                </View>
              </>
            )}
          </View>
        );
      })}
      {!!note && <Text style={[shared.small, s.note]}>{note}</Text>}
      <LegalSheet doc={reading} onClose={() => setReading(null)} />
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    flat: { marginBottom: 0 },
    title: { color: colors.text, fontFamily: fonts.semibold, fontSize: 14 },
    label: { marginTop: 12, marginBottom: 6 },
    missing: {
      fontFamily: fonts.regular,
      fontSize: 13,
      lineHeight: 19,
      color: colors.warningStrong,
      backgroundColor: colors.warningSoft,
      borderRadius: 10,
      padding: 10,
      marginTop: 10,
    },
    multiline: { minHeight: 84, textAlignVertical: "top" },
    editor: {
      minHeight: 220,
      textAlignVertical: "top",
      marginTop: 10,
      fontSize: 13,
    },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
    doc: {
      marginTop: 14,
      paddingTop: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    docTitle: {
      fontFamily: fonts.semibold,
      fontSize: 14,
      color: colors.text,
      marginBottom: 2,
    },
    note: { marginTop: 10 },
  }),
);
