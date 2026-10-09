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
        Uses your ChatGPT plan. Keep Orbyn desktop online for morning summaries.
      </Text>
      {!data && !error && (
        <Text accessibilityLiveRegion="polite" style={shared.small}>
          Loading summary settings…
        </Text>
      )}
      {data && (
        <>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Text style={[shared.small, { flex: 1 }]}>Use ChatGPT</Text>
            <Switch
              accessibilityLabel="Use ChatGPT for morning summaries"
              value={data.permission.enabled}
              trackColor={{ true: colors.accent }}
              disabled={busy || (!data.permission.enabled && !canEnable)}
              onValueChange={(value) => void save(value)}
            />
          </View>
          {data.permission.enabled && (
            <Text style={shared.small}>
              {data.permission.active
                ? `On · ${data.permission.model}`
                : "Review your model choice to resume."}
            </Text>
          )}
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
          {canEnable && data.permission.enabled && (
            <Text style={shared.small}>
              {data.catalog?.preference.model} ·{" "}
              {data.choice.fallback_to_default
                ? "Orbyn fallback"
                : "No fallback"}
            </Text>
          )}
          {data.permission.enabled && (
            <Text accessibilityLiveRegion="polite" style={shared.small}>
              {data.summary.run ? `${data.summary.run.local_day} · ` : ""}
              {agendaPrivateSummaryText(data.summary)}
            </Text>
          )}
        </>
      )}
      {error && (
        <Text accessibilityRole="alert" style={shared.small}>
          {error}
        </Text>
      )}
      {(data?.permission.enabled || error) && (
        <SmallAction
          label="Refresh summary"
          disabled={busy}
          onPress={refresh}
        />
      )}
    </View>
  );
}
