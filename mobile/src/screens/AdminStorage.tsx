import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { AdminStorage as Storage } from "@orbyn/core";
import { SmallAction } from "../components/SmallAction";
import { client } from "../lib/api";
import { confirmAction } from "../lib/confirm";
import { colors, fonts, radii, themed } from "../theme";
import { shared } from "../styles";

type Act = (fn: () => Promise<void>) => Promise<void>;

const bytes = (n: number | null | undefined) => {
  if (n === null || n === undefined) return "—";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
};

const ago = (iso: string | null) => {
  if (!iso) return "—";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
};

const SCANS: Record<Storage["reading"]["scans"], string> = {
  tesseract: "Tesseract (built in)",
  full: "Heavy OCR model",
  none: "Not available",
  unknown: "Converter not reporting",
};

/**
 * Admin → Storage on the phone: the database's size, the files on the
 * server and when each goes, and the import queue. Admins can delete a file
 * but never open one.
 */
export function AdminStorage({ act, busy }: { act: Act; busy: boolean }) {
  const [data, setData] = useState<Storage | null>(null);
  const [note, setNote] = useState("");
  const load = useCallback(
    () => act(async () => setData(await client.adminStorage())),
    [act],
  );
  useEffect(() => {
    void load();
  }, [load]);

  if (!data) return <Text style={shared.small}>Loading storage…</Text>;
  const used =
    data.files.disk_total && data.files.disk_free !== null
      ? 1 - data.files.disk_free / data.files.disk_total
      : null;

  return (
    <View style={s.list}>
      <View style={s.tiles}>
        <View style={s.tile}>
          <Text style={shared.small}>Database</Text>
          <Text style={s.value}>{bytes(data.database.bytes)}</Text>
        </View>
        <View style={s.tile}>
          <Text style={shared.small}>
            File store · {data.files.count} file
            {data.files.count === 1 ? "" : "s"}
          </Text>
          <Text style={s.value}>
            {data.files.reachable ? bytes(data.files.bytes) : "Not reachable"}
          </Text>
          {used !== null && (
            <Text style={shared.small}>
              {Math.round(used * 100)}% of disk used
            </Text>
          )}
        </View>
      </View>
      <View style={shared.card}>
        <Text style={s.title}>Reading scans</Text>
        <Text style={shared.body}>{SCANS[data.reading.scans]}</Text>
        <Text style={shared.small}>
          {data.reading.formulas
            ? "Equations on scans read too"
            : "Equations on scans not read"}{" "}
          · {data.reading.workers} at a time
        </Text>
        <Text style={[shared.small, !data.reading.converter_ok && s.bad]}>
          Converter{" "}
          {data.reading.converter_ok
            ? `reported ${ago(data.reading.converter_seen_at)}`
            : "is not running"}
        </Text>
        <Text style={[s.title, s.gapTop]}>Import queue</Text>
        <Text style={shared.small}>
          {data.queue.pages_waiting} page
          {data.queue.pages_waiting === 1 ? "" : "s"} waiting ·{" "}
          {data.queue.queued + data.queue.waiting} files waiting ·{" "}
          {data.queue.reading + data.queue.ocr} reading
          {data.queue.seconds_per_page !== null
            ? ` · ${data.queue.seconds_per_page} s a page`
            : ""}
        </Text>
        {data.queue.failed_today > 0 && (
          <Text style={[shared.small, s.bad]}>
            {data.queue.failed_today} failed today:{" "}
            {data.queue.reasons.map((r) => r.error).join(" · ")}
          </Text>
        )}
      </View>
      <View style={shared.card}>
        <Text style={s.title}>Files on the server</Text>
        <Text style={shared.small}>
          Each is deleted when its import ends, and always within a day. You can
          delete a file, but not open one.
        </Text>
        {!!note && <Text style={[shared.small, s.note]}>{note}</Text>}
        {data.stored.length === 0 ? (
          <Text style={[shared.small, s.gapTop]}>
            No files are stored right now.
          </Text>
        ) : (
          data.stored.map((f) => (
            <View key={f.import_id} style={s.file}>
              <Text style={shared.body} numberOfLines={1}>
                {f.file_name}
              </Text>
              <Text style={shared.small}>
                {f.owner_name} · {bytes(f.bytes)} · {f.status} · uploaded{" "}
                {ago(f.uploaded_at)}
              </Text>
              <SmallAction
                label="Delete now"
                destructive
                disabled={busy}
                onPress={() =>
                  confirmAction(
                    `Delete ${f.file_name} now?`,
                    `The upload from ${f.owner_name} is deleted and its import cancelled. This is recorded in the audit log.`,
                    "Delete now",
                    () =>
                      void act(async () => {
                        await client.adminDeleteStoredFile(f.import_id);
                        setNote(`Deleted ${f.file_name}.`);
                        setData(await client.adminStorage());
                      }),
                  )
                }
              />
            </View>
          ))
        )}
        <View style={s.row}>
          <SmallAction
            label="Refresh"
            disabled={busy}
            onPress={() => void load()}
          />
          <SmallAction
            label="Run sweep now"
            disabled={busy}
            onPress={() =>
              void act(async () => {
                const { removed } = await client.adminSweepStorage();
                setNote(
                  removed
                    ? `Swept ${removed} file${removed === 1 ? "" : "s"}.`
                    : "Nothing to sweep.",
                );
                setData(await client.adminStorage());
              })
            }
          />
        </View>
      </View>
      {data.history.length > 0 && (
        <View style={shared.card}>
          <Text style={s.title}>Imports in the last 30 days</Text>
          {data.history.slice(0, 20).map((h) => (
            <View key={h.id} style={s.file}>
              <Text style={shared.body} numberOfLines={1}>
                {h.file_name}
              </Text>
              <Text style={[shared.small, h.status === "failed" && s.bad]}>
                {h.owner_name} · {h.pages ?? "—"} pages · {h.status}
                {h.seconds !== null ? ` · ${h.seconds} s` : ""} ·{" "}
                {ago(h.created_at)}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    list: { gap: 12 },
    tiles: { flexDirection: "row", gap: 10 },
    tile: {
      flex: 1,
      gap: 2,
      padding: 14,
      borderRadius: radii.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    value: { fontFamily: fonts.display, fontSize: 20, color: colors.text },
    title: { fontFamily: fonts.semibold, fontSize: 15, color: colors.text },
    gapTop: { marginTop: 12 },
    bad: { color: colors.danger },
    note: { color: colors.accent, marginTop: 6 },
    file: {
      gap: 4,
      paddingVertical: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      marginTop: 8,
    },
    row: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  }),
);
