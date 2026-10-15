import React, { useEffect, useRef, useState } from "react";
import {
  Linking,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { dateLabel, type ProgressReport, type Team } from "@orbyn/core";
import { Button } from "../components/Button";
import { Chip, ChipRow } from "../components/Chip";
import { SmallAction } from "../components/SmallAction";
import { InlineDetails } from "../components/InlineDetails";
import { Icon } from "../components/Icon";
import { Segmented } from "../components/Segmented";
import { Sheet, sheetStyles } from "../components/Sheet";
import { client } from "../lib/api";
import { colors, fonts, themed } from "../theme";
import { shared } from "../styles";
import { errorText } from "../lib/errors";

const WEEKS = ["this", "last"] as const;

const mondayOf = (back: number) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - back * 7);
  return d;
};

/**
 * Proof of progress: what got done this week (or last), yours or a team's,
 * with the proof beside each, and Share to send it as text.
 */
export function ProgressSheet({
  visible,
  teams,
  onClose,
  onDismiss,
}: {
  visible: boolean;
  teams: Team[];
  onClose: () => void;
  onDismiss?: () => void;
}) {
  return (
    <Sheet
      visible={visible}
      title="Progress"
      onClose={onClose}
      onDismiss={onDismiss}
    >
      {visible && <Body teams={teams} />}
    </Sheet>
  );
}

function Body({ teams }: { teams: Team[] }) {
  const [retry, setRetry] = useState(0);
  const [sharing, setSharing] = useState(false);
  const mutation = useRef(false);
  const [week, setWeek] = useState<(typeof WEEKS)[number]>("this");
  const [teamId, setTeamId] = useState<string | null>(null);
  const [report, setReport] = useState<ProgressReport | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setReport(null);
    setError("");
    const from = mondayOf(week === "this" ? 0 : 1);
    const to = new Date(from.getTime() + 7 * 86_400_000);
    client.progress(from, to, teamId ?? undefined).then(
      (value) => {
        if (live) setReport(value);
      },
      (error) => {
        if (live) setError(errorText(error));
      },
    );
    return () => {
      live = false;
    };
  }, [week, teamId, retry]);
  const count = report?.people.reduce((n, p) => n + p.done.length, 0) ?? 0;
  return (
    <ScrollView contentContainerStyle={sheetStyles.body}>
      <View style={[sheetStyles.column, s.column]}>
        <Segmented
          options={WEEKS}
          value={week}
          labels={{ this: "This week", last: "Last week" }}
          accessibilityLabel="Week"
          onChange={setWeek}
        />
        {teams.length > 0 && (
          <InlineDetails
            title={
              teamId
                ? `Scope: ${teams.find((team) => team.id === teamId)?.name ?? "Team"}`
                : "Scope: just mine"
            }
          >
            <ChipRow label="Progress scope">
              <Chip
                label="Just mine"
                selected={!teamId}
                onPress={() => setTeamId(null)}
              />
              {teams.map((t) => (
                <Chip
                  key={t.id}
                  label={t.name}
                  selected={teamId === t.id}
                  onPress={() => setTeamId(t.id)}
                />
              ))}
            </ChipRow>
          </InlineDetails>
        )}
        {!!error && (
          <View>
            <Text style={[shared.small, s.bad]} accessibilityRole="alert">
              {error}
            </Text>
            <SmallAction
              label="Retry"
              disabled={false}
              onPress={() => setRetry((value) => value + 1)}
            />
          </View>
        )}
        {!report ? (
          !error && <Text style={shared.small}>Loading…</Text>
        ) : count === 0 ? (
          <Text style={shared.small}>No completed tasks for this period.</Text>
        ) : (
          report.people.map((p) => (
            <View key={p.user_id} style={shared.card}>
              {!!teamId && <Text style={shared.sectionTitle}>{p.name}</Text>}
              {p.done.map((t, n) => (
                <View key={t.item_id} style={[s.row, n > 0 && s.divider]}>
                  <Icon name="check" size={15} color={colors.accent} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.title}>{t.title}</Text>
                    <Text style={shared.small}>
                      {dateLabel(t.done_at)}
                      {t.project ? ` · ${t.project}` : ""}
                    </Text>
                    {t.proofs.map((f, k) => (
                      <Text
                        key={k}
                        style={[shared.small, !!f.url && s.link]}
                        accessibilityRole={f.url ? "link" : undefined}
                        onPress={
                          f.url
                            ? () =>
                                void Linking.openURL(f.url!).catch((error) =>
                                  setError(errorText(error)),
                                )
                            : undefined
                        }
                      >
                        {f.note || "Proof"}
                      </Text>
                    ))}
                  </View>
                </View>
              ))}
            </View>
          ))
        )}
        {report && count > 0 && (
          <Button
            secondary
            title="Share as text"
            icon="share"
            disabled={sharing}
            onPress={() => {
              if (mutation.current) return;
              mutation.current = true;
              setSharing(true);
              void Share.share({ message: report.markdown })
                .catch((error) => setError(errorText(error)))
                .finally(() => {
                  mutation.current = false;
                  setSharing(false);
                });
            }}
          />
        )}
      </View>
    </ScrollView>
  );
}

const s = themed(() =>
  StyleSheet.create({
    column: { gap: 12 },
    row: { flexDirection: "row", gap: 10, paddingVertical: 10 },
    divider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    title: { fontFamily: fonts.medium, fontSize: 13, color: colors.text },
    link: { color: colors.accent, minHeight: 44, paddingVertical: 10 },
    bad: { color: colors.danger },
  }),
);
