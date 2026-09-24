import React from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  MODE_LABELS,
  modesFor,
  type Doc,
  type DocMode,
  type DocTag,
} from "@orbyn/core";
import { BottomSheet } from "../../components/BottomSheet";
import { Chip, ChipRow } from "../../components/Chip";
import { SmallAction } from "../../components/SmallAction";
import { PageFreshness } from "../../components/followthrough/PageFreshness";
import { colors, fonts, themed } from "../../theme";
import { DocViewers } from "./DocViewers";
import { PageTags } from "./PageTags";

const KIND_NAMES: Record<Doc["kind"], string> = {
  doc: "Page",
  note: "Note",
  agenda: "Agenda",
  meeting: "Meeting note",
};

/**
 * A page's Info (ⓘ in its header): how you're working on it, what it
 * belongs to, its tags, whether it's still true, who's here, its size, and
 * its history. The facts that used to stack above the words live here, so
 * the page starts with its title and its text.
 */
export function PageInfo({
  visible,
  doc,
  tags,
  mode,
  canWrite,
  reading,
  facts,
  onMode,
  onTags,
  onShowHistory,
  onClose,
  report,
}: {
  visible: boolean;
  doc: Doc;
  tags: DocTag[];
  mode: DocMode;
  canWrite: boolean;
  /** The page is only being read (its tags can't be changed then). */
  reading: boolean;
  /** "1,204 words · 5 min read · Saved 2 min ago". */
  facts: string;
  onMode: (mode: DocMode) => void;
  onTags: (tags: DocTag[]) => void;
  onShowHistory: () => void;
  onClose: () => void;
  report: (e: unknown) => void;
}) {
  const belongs = [
    KIND_NAMES[doc.kind],
    doc.team_name ? `in ${doc.team_name}` : "Only you",
    doc.project_name ? `for ${doc.project_name}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <BottomSheet visible={visible} title="Info" onClose={onClose}>
      <View style={s.body}>
        <Section label="How you’re working on this page">
          <ChipRow label="How you're working on this page">
            {modesFor(canWrite).map((m) => (
              <Chip
                key={m}
                compact
                label={MODE_LABELS[m].name}
                selected={mode === m}
                accessibilityHint={MODE_LABELS[m].blurb}
                onPress={() => onMode(m)}
              />
            ))}
          </ChipRow>
          <Text style={s.small}>{MODE_LABELS[mode].blurb}</Text>
        </Section>
        <Section label="Belongs to">
          <Text style={s.text}>{belongs}</Text>
        </Section>
        <Section label="Tags">
          <PageTags
            docId={doc.id}
            teamId={doc.team_id}
            tags={tags}
            canWrite={canWrite && !reading}
            onChange={onTags}
            report={report}
          />
          {!tags.length && !(canWrite && !reading) && (
            <Text style={s.small}>No tags.</Text>
          )}
        </Section>
        {doc.kind === "doc" && <PageFreshness doc={doc} canWrite={canWrite} />}
        <Section label="Here now">
          <View style={s.row}>
            <DocViewers docId={doc.id} register={false} />
            <Text style={s.small}>{facts}</Text>
          </View>
        </Section>
        <View style={s.actions}>
          <SmallAction
            label="Show history"
            disabled={false}
            onPress={onShowHistory}
          />
        </View>
      </View>
    </BottomSheet>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View style={s.section}>
      <Text style={s.label}>{label}</Text>
      {children}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    body: { gap: 18, paddingTop: 6, paddingBottom: 8 },
    section: { gap: 8 },
    label: {
      fontFamily: fonts.semibold,
      fontSize: 11,
      letterSpacing: 0.6,
      textTransform: "uppercase",
      color: colors.muted,
    },
    text: { fontFamily: fonts.regular, fontSize: 15, color: colors.text },
    small: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
    row: { flexDirection: "row", alignItems: "center", gap: 10 },
    actions: { flexDirection: "row", gap: 8 },
  }),
);
