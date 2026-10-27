import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { fileSizeLabel, type Doc, type OriginalsOverview } from "@orbyn/core";
import { client } from "../../../lib/api";
import { session } from "../../../lib/session";
import { errorText } from "../../../lib/errors";
import { Switch } from "../../../components/Switch";
import { saveFile, takeAwayLabel } from "../../../lib/download";
import { ActionSheet, MoreMenu } from "../../../components/MoreMenu";
import { SmallAction } from "../../../components/SmallAction";
import { colors, fonts, themed } from "../../../theme";

/**
 * The file an imported page came from, when it was kept: take it away, or
 * delete it and keep only the page. In the page's Info.
 */
export function OriginalSection(
  props: Parameters<typeof OriginalSectionBody>[0],
) {
  return (
    <OriginalSectionBody key={`${session.token}:${props.doc.id}`} {...props} />
  );
}

function OriginalSectionBody({
  doc,
  canWrite,
  onBusyChange,
}: {
  doc: Pick<Doc, "id" | "original">;
  canWrite: boolean;
  report: (e: unknown) => void;
  onBusyChange?: (pending: boolean) => void;
}) {
  const owner = useRef(session.token).current;
  const mounted = useRef(true),
    mutation = useRef(false);
  const busyChanged = useRef(onBusyChange);
  busyChanged.current = onBusyChange;
  const owns = () => mounted.current && session.token === owner;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (mutation.current) {
        mutation.current = false;
        busyChanged.current?.(false);
      }
    };
  }, []);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [gone, setGone] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<string | null>(null);
  const signature = JSON.stringify(doc.original);
  const latest = useRef({ signature, canWrite });
  latest.current = { signature, canWrite };
  useEffect(() => setPrompt(null), [signature]);
  const act = async (operation: () => Promise<void>) => {
    if (!owns() || mutation.current) return;
    mutation.current = true;
    setBusy(true);
    setError("");
    busyChanged.current?.(true);
    try {
      await operation();
    } catch (e) {
      if (owns()) setError(errorText(e));
    } finally {
      mutation.current = false;
      if (owns()) {
        setBusy(false);
        busyChanged.current?.(false);
      }
    }
  };
  const original = doc.original;
  if (!original || gone === signature) return null;
  const download = () =>
    void act(async () => {
      const file = await client.downloadOriginal(doc.id);
      if (!owns() || latest.current.signature !== signature) return;
      await saveFile(
        file.name,
        file.blob,
        file.blob.type || "application/octet-stream",
      );
    });
  return (
    <View style={s.section}>
      <Text style={s.label}>Original file</Text>
      <Text style={s.text}>
        {original.file_name} · {fileSizeLabel(Number(original.bytes))}
      </Text>
      {!!error && (
        <Text accessibilityRole="alert" style={s.error}>
          {error}
        </Text>
      )}
      <View style={s.actions}>
        <SmallAction
          label={takeAwayLabel()}
          disabled={busy}
          onPress={download}
        />
        {canWrite && (
          <MoreMenu
            label="Original file options"
            disabled={busy}
            actions={[
              {
                label: "Delete original",
                destructive: true,
                onPress: () => setPrompt(signature),
              },
            ]}
          />
        )}
      </View>
      <ActionSheet
        visible={prompt !== null}
        label="Delete original"
        title={`Delete “${original.file_name}”?`}
        message="Permanently deletes the original file. The page stays."
        cancelLabel="Keep original"
        actions={[
          {
            label: "Delete original",
            destructive: true,
            disabled: busy || !canWrite,
            onPress: () => {
              if (
                !owns() ||
                !latest.current.canWrite ||
                prompt !== latest.current.signature
              )
                return;
              void act(async () => {
                await client.deleteOriginal(doc.id);
                if (owns()) setGone(signature);
              });
            },
          },
        ]}
        onClose={() => setPrompt(null)}
      />
    </View>
  );
}

/** "Keep the original", where files come in: off by default. */
export function KeepOriginals(props: { report: (e: unknown) => void }) {
  return <KeepOriginalsBody key={session.token} {...props} />;
}
function KeepOriginalsBody(_props: { report: (e: unknown) => void }) {
  const owner = useRef(session.token).current;
  const mounted = useRef(true);
  const owns = () => mounted.current && session.token === owner;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [error, setError] = useState("");
  const [state, setState] = useState<OriginalsOverview | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const mutation = useRef(false);
  useEffect(() => {
    let live = true;
    setFailed(false);
    client.originals().then(
      (value) => {
        if (live && owns()) setState(value);
      },
      () => {
        if (live && owns()) setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [retry]);
  if (!state)
    return (
      <View style={s.section}>
        <Text style={s.small}>
          {failed
            ? "File storage couldn’t be loaded."
            : "Loading file storage…"}
        </Text>
        {failed && (
          <SmallAction
            label="Retry"
            disabled={false}
            onPress={() => setRetry((value) => value + 1)}
          />
        )}
      </View>
    );
  return (
    <View>
      {!!error && (
        <Text accessibilityRole="alert" style={s.error}>
          {error}
        </Text>
      )}
      <View style={s.switchRow}>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Keep encrypted originals</Text>
          <Text style={s.small}>
            Applies to new imports. {fileSizeLabel(state.used_bytes)} of{" "}
            {fileSizeLabel(state.quota_bytes)} used.
          </Text>
        </View>
        <Switch
          trackColor={{ true: colors.accent }}
          accessibilityLabel="Keep the original of new imports"
          value={state.keep}
          disabled={busy}
          onValueChange={(keep) => {
            if (!owns() || mutation.current) return;
            mutation.current = true;
            setBusy(true);
            setError("");
            const previous = state;
            setState({ ...state, keep });
            void client
              .setKeepOriginals(keep)
              .then((result) => {
                if (owns())
                  setState((current) =>
                    current ? { ...current, keep: result.keep } : current,
                  );
              })
              .catch((error) => {
                if (owns()) {
                  setState(previous);
                  setError(errorText(error));
                }
              })
              .finally(() => {
                mutation.current = false;
                if (owns()) setBusy(false);
              });
          }}
        />
      </View>
      {failed && (
        <SmallAction
          label="Retry file storage"
          disabled={busy}
          onPress={() => setRetry((n) => n + 1)}
        />
      )}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    error: { fontSize: 13, color: colors.danger },
    section: { gap: 8 },
    label: {
      fontFamily: fonts.semibold,
      fontSize: 11,
      color: colors.muted,
    },
    text: { fontFamily: fonts.regular, fontSize: 13, color: colors.text },
    small: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
    title: { fontFamily: fonts.medium, fontSize: 13, color: colors.text },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    switchRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingVertical: 8,
    },
  }),
);
