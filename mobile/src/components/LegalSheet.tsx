import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { LegalDoc, LegalDocument } from "@orbyn/core";
import { client } from "../lib/api";
import { colors, fonts, themed } from "../theme";
import { Sheet, sheetStyles } from "./Sheet";
import { errorText } from "../lib/errors";

/** `**bold**` inside a line. */
function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <Text key={i} style={s.strong}>
            {part.slice(2, -2)}
          </Text>
        ) : (
          part
        ),
      )}
    </>
  );
}

/**
 * A legal document's Markdown: headings, `-` lists and paragraphs — the same
 * small subset the desktop renders.
 */
export function LegalText({ body }: { body: string }) {
  return (
    <View>
      {body
        .trim()
        .split(/\n{2,}/)
        .map((block, i) => {
          const lines = block.split("\n");
          if (lines.every((l) => l.startsWith("- ")))
            return (
              <View key={i} style={s.list}>
                {lines.map((l, j) => (
                  <View key={j} style={s.item}>
                    <Text style={s.bullet}>•</Text>
                    <Text style={[s.body, s.itemText]}>
                      <Inline text={l.slice(2)} />
                    </Text>
                  </View>
                ))}
              </View>
            );
          const heading = block.match(/^(#{1,3}) (.*)$/);
          if (heading && lines.length === 1)
            return (
              <Text
                key={i}
                accessibilityRole="header"
                style={heading[1].length === 1 ? s.h1 : s.h2}
              >
                <Inline text={heading[2]} />
              </Text>
            );
          return (
            <Text key={i} style={[s.body, i === 1 && s.version]}>
              <Inline text={lines.join(" ")} />
            </Text>
          );
        })}
    </View>
  );
}

/** Read the Terms or the Privacy Policy in a sheet. */
export function LegalSheet({
  doc,
  onClose,
}: {
  doc: LegalDoc | null;
  onClose: () => void;
}) {
  const [document, setDocument] = useState<LegalDocument | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!doc) return;
    let alive = true;
    setDocument(null);
    setError("");
    client
      .legalDocument(doc)
      .then((d) => alive && setDocument(d))
      .catch((e: Error) => alive && setError(errorText(e)));
    return () => {
      alive = false;
    };
  }, [doc]);
  return (
    <Sheet
      visible={!!doc}
      title={doc === "privacy" ? "Privacy Policy" : "Terms of Service"}
      onClose={onClose}
    >
      <ScrollView contentContainerStyle={sheetStyles.body}>
        <View style={sheetStyles.column}>
          {error ? (
            <Text style={[s.body, { color: colors.danger }]}>{error}</Text>
          ) : document ? (
            <LegalText body={document.body} />
          ) : (
            <Text style={[s.body, { color: colors.muted }]}>Loading…</Text>
          )}
        </View>
      </ScrollView>
    </Sheet>
  );
}

const s = themed(() =>
  StyleSheet.create({
    h1: {
      fontFamily: fonts.display,
      fontSize: 26,
      lineHeight: 32,
      color: colors.text,
      marginBottom: 2,
    },
    h2: {
      fontFamily: fonts.display,
      fontSize: 17,
      lineHeight: 23,
      color: colors.text,
      marginTop: 20,
      marginBottom: 6,
    },
    body: {
      fontFamily: fonts.regular,
      fontSize: 15,
      lineHeight: 23,
      color: colors.text,
      marginBottom: 10,
    },
    version: { fontSize: 13, color: colors.muted, marginBottom: 16 },
    strong: { fontFamily: fonts.bold },
    list: { marginBottom: 10, gap: 4 },
    item: { flexDirection: "row", gap: 8 },
    bullet: {
      fontFamily: fonts.regular,
      fontSize: 15,
      lineHeight: 23,
      color: colors.muted,
    },
    itemText: { flex: 1, marginBottom: 0 },
  }),
);
