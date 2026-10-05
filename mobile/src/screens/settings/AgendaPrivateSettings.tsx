import { agendaPrivateSummaryText } from "@orbyn/core";
import { Text, View, Switch } from "react-native";
import { useAgendaPrivateSettings } from "../../hooks/useAgendaPrivateSettings";
import { SmallAction } from "../../components/SmallAction";
import { shared } from "../../styles";
import { colors } from "../../theme";
/** Native scheduling uses the same reviewed permission and durable status as web. */
export function AgendaPrivateSettings({ userId }: { userId: string }) {
  const { data, error, busy, canEnable, enablementMessage, save, refresh } =
    useAgendaPrivateSettings(userId);
  return (
    <View style={{ gap: 12 }}>
      <Text style={shared.body}>Morning summary</Text>
      <Text style={shared.small}>
        Use your selected ChatGPT model for scheduled Agenda summaries.
      </Text>
      {!data && !error && (
        <Text accessibilityLiveRegion="polite" style={shared.small}>
          Loading summary settings…
        </Text>
      )}
      {data && (
        <>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Text style={[shared.small, { flex: 1 }]}>
              Allow scheduled ChatGPT summaries
            </Text>
            <Switch
              accessibilityLabel="Allow scheduled ChatGPT summaries"
              value={data.permission.enabled}
              trackColor={{ true: colors.accent }}
              disabled={busy || (!data.permission.enabled && !canEnable)}
              onValueChange={(value) => void save(value)}
            />
          </View>
          <Text style={shared.small}>
            {data.permission.enabled && !data.permission.active
              ? "Permission needs review after your AI settings changed."
              : data.permission.active
                ? `Enabled · ${data.permission.model}`
                : "Off"}
          </Text>
          {!canEnable && !data.permission.active && (
            <Text style={shared.small}>{enablementMessage}</Text>
          )}
          {data.permission.enabled && !data.permission.active && (
            <SmallAction
              label="Use reviewed model"
              disabled={busy || !canEnable}
              onPress={() => void save(true)}
            />
          )}
          {canEnable && (
            <Text style={shared.small}>
              {data.catalog?.preference.model}
              {data.choice.fallback_to_default
                ? " · Orbyn fallback allowed"
                : " · No fallback"}
              . Your desktop app must be online.
            </Text>
          )}
          <Text accessibilityLiveRegion="polite" style={shared.small}>
            {data.summary.run ? `${data.summary.run.local_day} · ` : ""}
            {agendaPrivateSummaryText(data.summary)}
          </Text>
        </>
      )}
      {error && (
        <Text accessibilityRole="alert" style={shared.small}>
          {error}
        </Text>
      )}
      <SmallAction
        label="Refresh summary settings"
        disabled={busy}
        onPress={refresh}
      />
    </View>
  );
}
