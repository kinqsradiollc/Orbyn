import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { client } from "../../lib/api";
import { colors, fonts, radii, themed } from "../../theme";

export type Person = { id: string; name: string; email: string };

/**
 * A comment box that can name people.
 *
 * Typing `@` offers the people who can already see this page, and nobody
 * else: naming someone is not a way to show them a document they have no
 * business reading. The name goes into the text as plain words and the
 * person's id is kept beside it, so the body still reads for anyone and the
 * notice still reaches the right person.
 */
export function MentionInput({
  docId,
  value,
  onChangeText,
  onNamed,
  named,
  placeholder,
  autoFocus,
  editable = true,
  accessibilityLabel,
}: {
  docId: string;
  value: string;
  onChangeText: (text: string) => void;
  /** Called with everyone the text still names, whenever it changes. */
  onNamed: (ids: string[]) => void;
  named: Map<string, string>;
  placeholder: string;
  autoFocus?: boolean;
  editable?: boolean;
  accessibilityLabel: string;
}) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [query, setQuery] = useState<string | null>(null);

  // The list is fetched once, the first time anyone reaches for it.
  useEffect(() => {
    if (query === null || people !== null) return;
    client.docPeople(docId).then(setPeople, () => setPeople([]));
  }, [query, people, docId]);

  /**
   * The name being typed after an `@`, or null when there isn't one.
   *
   * This reads the text rather than the caret. A phone keyboard reports
   * where the caret is only after the fact, so following it meant the
   * picker never opened; the last `@` with an unfinished word after it is
   * what somebody is typing, which is the case that matters.
   */
  const watch = (text: string) => {
    const mark = text.lastIndexOf("@");
    if (mark === -1) return setQuery(null);
    const word = text.slice(mark + 1);
    if (/\s/.test(word) || word.length > 30) return setQuery(null);
    if (mark > 0 && !/\s/.test(text[mark - 1])) return setQuery(null);
    setQuery(word);
  };

  const matches = (people ?? [])
    .filter((p) =>
      query ? p.name.toLowerCase().includes(query.toLowerCase()) : true,
    )
    .slice(0, 5);

  const choose = (person: Person) => {
    const mark = value.lastIndexOf("@");
    const next = `${value.slice(0, mark)}@${person.name} `;
    named.set(person.id, person.name);
    onChangeText(next);
    setQuery(null);
    onNamed(stillNamed(next, named));
  };

  return (
    <View>
      <TextInput
        style={s.input}
        value={value}
        placeholder={placeholder}
        placeholderTextColor={colors.faint}
        multiline
        editable={editable}
        autoFocus={autoFocus}
        maxLength={4000}
        accessibilityLabel={accessibilityLabel}
        onChangeText={(text) => {
          onChangeText(text);
          watch(text);
          onNamed(stillNamed(text, named));
        }}
      />
      {editable && query !== null && matches.length > 0 && (
        <View style={s.list} accessibilityRole="menu">
          {matches.map((person) => (
            <Pressable
              key={person.id}
              accessibilityRole="menuitem"
              accessibilityLabel={`Name ${person.name}`}
              onPress={() => choose(person)}
              style={({ pressed }) => [s.row, pressed && s.rowPressed]}
            >
              <Text style={s.name}>{person.name}</Text>
              <Text style={s.email}>{person.email}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

/**
 * The people a body still names. Someone whose name has been deleted from
 * the text is no longer being spoken to, so they are not told about it.
 */
export const stillNamed = (text: string, named: Map<string, string>) =>
  [...named.entries()]
    .filter(([, name]) => text.includes(`@${name}`))
    .map(([id]) => id);

const s = themed(() =>
  StyleSheet.create({
    input: {
      color: colors.text,
      fontSize: 14,
      minHeight: 56,
      textAlignVertical: "top",
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.input,
      backgroundColor: colors.surface,
      paddingHorizontal: 10,
      paddingVertical: 8,
      fontFamily: fonts.regular,
    },
    list: {
      marginTop: 4,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.input,
      backgroundColor: colors.surface,
      overflow: "hidden",
    },
    row: { paddingHorizontal: 10, paddingVertical: 8, gap: 1 },
    rowPressed: { backgroundColor: colors.surfaceMuted },
    name: { color: colors.text, fontSize: 14, fontFamily: fonts.semibold },
    email: { color: colors.muted, fontSize: 12 },
  }),
);
