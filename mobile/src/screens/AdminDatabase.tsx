import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Switch } from "../components/Switch";
import {
  SYSTEM_ROLES,
  type AdminDatabaseRows,
  type AdminDatabaseTable,
  type AdminDatabaseTableDetail,
  type SystemRole,
} from "@orbyn/core";
import { Chip, ChipRow } from "../components/Chip";
import { Icon } from "../components/Icon";
import { Segmented } from "../components/Segmented";
import { SmallAction } from "../components/SmallAction";
import { client } from "../lib/api";
import { confirmAction } from "../lib/confirm";
import { colors, fonts, radii, themed } from "../theme";
import { shared } from "../styles";

type Act = (fn: () => Promise<void>) => Promise<void>;
type Tab = "rows" | "columns" | "indexes";
type Row = Record<string, unknown>;

/** How a cell reads on a phone: NULL, JSON for structures, masked stays masked. */
const show = (value: unknown) =>
  value === null || value === undefined
    ? "NULL"
    : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);

/**
 * The database explorer, for system admins: the same tables, columns,
 * indexes and redacted rows as the desktop, laid out for a phone. Rows are
 * cards rather than a grid, since a table forty columns wide can't be read
 * sideways on a phone. Users and teams keep the desktop's validated edits,
 * each confirmed before it is saved.
 */
export function AdminDatabase({
  act,
  busy,
  meId,
}: {
  act: Act;
  busy: boolean;
  meId?: string;
}) {
  const [tables, setTables] = useState<AdminDatabaseTable[] | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    void act(async () => setTables(await client.adminDatabaseTables()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = useMemo(
    () =>
      (tables ?? []).filter((t) =>
        t.name.toLowerCase().includes(query.trim().toLowerCase()),
      ),
    [tables, query],
  );

  if (selected)
    return (
      <TableView
        key={selected}
        name={selected}
        act={act}
        busy={busy}
        meId={meId}
        onBack={() => setSelected(null)}
      />
    );

  return (
    <View style={s.root}>
      <Text style={shared.small}>
        Tables, columns, indexes and redacted rows. Secrets show as ••••.
      </Text>
      <View style={s.search}>
        <Icon name="search" size={16} color={colors.muted} />
        <TextInput
          style={s.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Find a table…"
          placeholderTextColor={colors.faint}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Find a table"
        />
      </View>
      {tables === null ? (
        <Text style={shared.small}>Loading tables…</Text>
      ) : (
        <View style={s.list}>
          <Text style={[shared.eyebrow, s.count]}>TABLES · {shown.length}</Text>
          {shown.length === 0 && (
            <Text style={[shared.small, s.pad]}>No table matches.</Text>
          )}
          {shown.map((t, n) => (
            <Pressable
              key={t.name}
              accessibilityRole="button"
              accessibilityLabel={
                t.estimated_rows > 0
                  ? `${t.name}, about ${t.estimated_rows} rows`
                  : `${t.name}, ${t.size}`
              }
              onPress={() => setSelected(t.name)}
              style={({ pressed }) => [
                s.tableRow,
                n > 0 && s.divided,
                pressed && { backgroundColor: colors.surfaceMuted },
              ]}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.tableName} numberOfLines={1}>
                  {t.name}
                </Text>
                <Text style={shared.small}>
                  {/* Postgres estimates rows only once a table is analysed;
                      before that the estimate is 0, which isn't a count. */}
                  {t.estimated_rows > 0
                    ? `About ${t.estimated_rows} rows · ${t.size}`
                    : t.size}
                </Text>
              </View>
              <Icon name="chevronRight" size={16} color={colors.faint} />
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

function TableView({
  name,
  act,
  busy,
  meId,
  onBack,
}: {
  name: string;
  act: Act;
  busy: boolean;
  meId?: string;
  onBack: () => void;
}) {
  const [detail, setDetail] = useState<AdminDatabaseTableDetail | null>(null);
  const [rows, setRows] = useState<AdminDatabaseRows | null>(null);
  const [tab, setTab] = useState<Tab>("rows");
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<number>>(new Set());

  const load = (offset = 0) =>
    act(async () => {
      const [d, r] = await Promise.all([
        detail ? Promise.resolve(detail) : client.adminDatabaseTable(name),
        client.adminDatabaseRows(name, offset),
      ]);
      setDetail(d);
      setRows((was) =>
        offset && was ? { ...r, rows: [...was.rows, ...r.rows] } : r,
      );
    });
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  const editable = name === "users" || name === "teams";
  const columns = detail?.columns ?? [];
  const key = columns.find((c) => c.primary_key)?.name ?? "id";

  return (
    <View style={s.root}>
      <Pressable
        accessibilityRole="button"
        onPress={onBack}
        hitSlop={8}
        style={s.back}
      >
        <Icon name="chevronLeft" size={16} color={colors.accent} />
        <Text style={s.backText}>All tables</Text>
      </Pressable>
      <View>
        <Text style={s.title} numberOfLines={2}>
          {name}
        </Text>
        {detail && (
          <Text style={shared.small}>
            {detail.table.estimated_rows > 0
              ? `About ${detail.table.estimated_rows} rows · `
              : ""}
            {detail.table.size} · {columns.length} columns
          </Text>
        )}
      </View>
      <Segmented
        accessibilityLabel="Table view"
        options={["rows", "columns", "indexes"] as Tab[]}
        value={tab}
        onChange={setTab}
      />
      {!detail || !rows ? (
        <Text style={shared.small}>Loading…</Text>
      ) : tab === "rows" ? (
        <>
          {rows.rows.length === 0 && (
            <Text style={shared.small}>This table is empty.</Text>
          )}
          {rows.rows.map((row, n) => {
            const id = String(row[key] ?? n);
            const expanded = open.has(n);
            const cells = Object.entries(row);
            return (
              <View key={id} style={s.card}>
                {(expanded ? cells : cells.slice(0, 5)).map(([k, v]) => (
                  <View key={k} style={s.cell}>
                    <Text style={s.cellKey} numberOfLines={1}>
                      {k}
                    </Text>
                    <Text
                      style={[s.cellValue, v === "••••" && s.masked]}
                      numberOfLines={expanded ? undefined : 1}
                      selectable
                    >
                      {show(v)}
                    </Text>
                  </View>
                ))}
                <View style={s.cardActions}>
                  {cells.length > 5 && (
                    <SmallAction
                      label={
                        expanded ? "Show less" : `All ${cells.length} columns`
                      }
                      disabled={false}
                      onPress={() => {
                        const next = new Set(open);
                        if (expanded) next.delete(n);
                        else next.add(n);
                        setOpen(next);
                      }}
                    />
                  )}
                  {editable && editing !== id && (
                    <SmallAction
                      label="Edit"
                      disabled={busy}
                      onPress={() => setEditing(id)}
                    />
                  )}
                </View>
                {editing === id &&
                  (name === "users" ? (
                    <UserEditor
                      row={row}
                      isMe={row.id === meId}
                      act={act}
                      busy={busy}
                      onDone={(saved) => {
                        setEditing(null);
                        if (saved) void load();
                      }}
                    />
                  ) : (
                    <TeamEditor
                      row={row}
                      act={act}
                      busy={busy}
                      onDone={(saved) => {
                        setEditing(null);
                        if (saved) void load();
                      }}
                    />
                  ))}
              </View>
            );
          })}
          {rows.has_more && (
            <SmallAction
              label="Load more rows"
              disabled={busy}
              onPress={() => void load(rows.offset + rows.limit)}
            />
          )}
        </>
      ) : tab === "columns" ? (
        <View style={s.list}>
          {columns.map((c, n) => (
            <View key={c.name} style={[s.detailRow, n > 0 && s.divided]}>
              <View style={s.nameLine}>
                <Text style={s.tableName} numberOfLines={1}>
                  {c.name}
                </Text>
                {c.primary_key && <Text style={s.pk}>PK</Text>}
              </View>
              <Text style={shared.small}>
                {c.type}
                {c.nullable ? " · nullable" : ""}
                {c.default_value ? ` · default ${c.default_value}` : ""}
              </Text>
              {!!c.description && (
                <Text style={shared.small}>{c.description}</Text>
              )}
            </View>
          ))}
        </View>
      ) : (
        <View style={s.list}>
          {detail.indexes.length === 0 && (
            <Text style={[shared.small, s.pad]}>No indexes.</Text>
          )}
          {detail.indexes.map((ix, n) => (
            <View key={ix.name} style={[s.detailRow, n > 0 && s.divided]}>
              <Text style={s.tableName}>{ix.name}</Text>
              <Text style={s.code} selectable>
                {ix.definition}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function UserEditor({
  row,
  isMe,
  act,
  busy,
  onDone,
}: {
  row: Row;
  isMe: boolean;
  act: Act;
  busy: boolean;
  onDone: (saved: boolean) => void;
}) {
  const [role, setRole] = useState(row.role as SystemRole);
  const [disabled, setDisabled] = useState(!!row.disabled);
  const [verified, setVerified] = useState(!!row.email_verified);
  const save = () => {
    const patch: {
      role?: SystemRole;
      disabled?: boolean;
      email_verified?: boolean;
    } = {};
    if (role !== row.role) patch.role = role;
    if (disabled !== !!row.disabled) patch.disabled = disabled;
    if (verified !== !!row.email_verified) patch.email_verified = verified;
    const changes = Object.entries(patch).map(
      ([k, v]) => `${k.replaceAll("_", " ")}: ${show(row[k])} → ${show(v)}`,
    );
    if (!changes.length) return onDone(false);
    confirmAction(
      `Save changes to ${show(row.email)}?`,
      `${changes.join("\n")}${isMe && patch.role === "member" ? "\nYou will lose admin access." : ""}`,
      "Save changes",
      () =>
        void act(async () => {
          await client.adminUpdateUser(String(row.id), patch);
          onDone(true);
        }),
    );
  };
  return (
    <View style={s.editor}>
      <Text style={s.editorLabel}>Role</Text>
      <ChipRow label="Role">
        {SYSTEM_ROLES.map((r) => (
          <Chip
            key={r}
            label={r === "admin" ? "Admin" : "Member"}
            selected={role === r}
            onPress={() => setRole(r)}
          />
        ))}
      </ChipRow>
      <View style={s.switchRow}>
        <Text style={s.switchLabel}>Disabled</Text>
        <Switch
          trackColor={{ true: colors.accent }}
          value={disabled}
          onValueChange={setDisabled}
        />
      </View>
      <View style={s.switchRow}>
        <Text style={s.switchLabel}>Email verified</Text>
        <Switch
          trackColor={{ true: colors.accent }}
          value={verified}
          onValueChange={setVerified}
        />
      </View>
      <View style={s.cardActions}>
        <SmallAction label="Save" disabled={busy} onPress={save} />
        <SmallAction
          label="Cancel"
          disabled={busy}
          onPress={() => onDone(false)}
        />
      </View>
    </View>
  );
}

function TeamEditor({
  row,
  act,
  busy,
  onDone,
}: {
  row: Row;
  act: Act;
  busy: boolean;
  onDone: (saved: boolean) => void;
}) {
  const [name, setName] = useState(show(row.name));
  const save = () => {
    const next = name.trim();
    if (!next || next === row.name) return onDone(false);
    confirmAction(
      "Rename team?",
      `“${show(row.name)}” → “${next}”`,
      "Save name",
      () =>
        void act(async () => {
          await client.updateTeam(String(row.id), { name: next });
          onDone(true);
        }),
    );
  };
  return (
    <View style={s.editor}>
      <Text style={s.editorLabel}>Team name</Text>
      <TextInput
        style={shared.input}
        value={name}
        onChangeText={setName}
        maxLength={80}
        accessibilityLabel="Team name"
      />
      <View style={s.cardActions}>
        <SmallAction
          label="Save"
          disabled={busy || !name.trim()}
          onPress={save}
        />
        <SmallAction
          label="Cancel"
          disabled={busy}
          onPress={() => onDone(false)}
        />
      </View>
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    root: { gap: 12 },
    search: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      minHeight: 44,
      paddingHorizontal: 12,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.input,
      backgroundColor: colors.surface,
    },
    searchInput: {
      flex: 1,
      minWidth: 0,
      paddingVertical: 10,
      color: colors.text,
      fontFamily: fonts.regular,
      fontSize: 15,
    },
    list: {
      overflow: "hidden",
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      backgroundColor: colors.surface,
    },
    count: { paddingHorizontal: 14, paddingTop: 12, marginBottom: 4 },
    pad: { padding: 14 },
    tableRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      minHeight: 52,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    divided: { borderTopWidth: 1, borderTopColor: colors.divider },
    tableName: { color: colors.text, fontFamily: fonts.semibold, fontSize: 14 },
    back: { flexDirection: "row", alignItems: "center", gap: 4 },
    backText: { color: colors.accent, fontFamily: fonts.medium, fontSize: 14 },
    title: { color: colors.text, fontFamily: fonts.display, fontSize: 20 },
    card: {
      gap: 6,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      backgroundColor: colors.surface,
    },
    cell: { flexDirection: "row", gap: 10 },
    cellKey: {
      width: 110,
      color: colors.muted,
      fontFamily: fonts.medium,
      fontSize: 12,
    },
    cellValue: {
      flex: 1,
      minWidth: 0,
      color: colors.text,
      fontFamily: fonts.regular,
      fontSize: 13,
    },
    masked: { color: colors.muted, letterSpacing: 1 },
    cardActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    detailRow: { gap: 3, paddingHorizontal: 14, paddingVertical: 11 },
    nameLine: { flexDirection: "row", alignItems: "center", gap: 8 },
    pk: {
      paddingHorizontal: 6,
      paddingVertical: 1,
      borderRadius: radii.pill,
      overflow: "hidden",
      backgroundColor: colors.accentSoft,
      color: colors.accent,
      fontFamily: fonts.semibold,
      fontSize: 10,
    },
    code: {
      color: colors.textSoft,
      fontFamily: fonts.regular,
      fontSize: 12,
    },
    editor: {
      gap: 10,
      marginTop: 4,
      padding: 12,
      borderRadius: radii.input,
      backgroundColor: colors.warningSoft,
      borderWidth: 1,
      borderColor: colors.warningBorder,
    },
    editorLabel: {
      color: colors.textSoft,
      fontFamily: fonts.semibold,
      fontSize: 13,
    },
    switchRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    switchLabel: { color: colors.text, fontFamily: fonts.medium, fontSize: 14 },
  }),
);
