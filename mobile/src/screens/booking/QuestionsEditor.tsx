import React from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { QUESTION_TYPES, type BookingQuestion } from "@orbyn/core";
import { Button } from "../../components/Button";
import { Field } from "../../components/Field";
import { Segmented } from "../../components/Segmented";
import { MoreMenu } from "../../components/MoreMenu";
import { SmallAction } from "../../components/SmallAction";
import { colors, fonts, themed } from "../../theme";
import { shared } from "../../styles";
import { MAX_OPTIONS, MAX_QUESTIONS, newKey } from "./helpers";
import { RemoveButton, SwitchRow, bookingStyles as bs } from "./ui";

/**
 * A question being edited. `id` is null until the page is saved; from then
 * on it never changes, even when the label does, since answers use it.
 */
export type QuestionDraft = {
  key: string;
  id: string | null;
  label: string;
  type: BookingQuestion["type"];
  required: boolean;
  options: string[];
};

export const draftOf = (q: BookingQuestion): QuestionDraft => ({
  key: newKey(),
  id: q.id,
  label: q.label,
  type: q.type,
  required: q.required,
  options: q.options,
});

const TYPE_LABELS: Record<BookingQuestion["type"], string> = {
  text: "Short",
  long_text: "Paragraph",
  choice: "Choice",
  phone: "Phone",
};

const cleanOptions = (options: string[]) =>
  options.map((o) => o.trim()).filter(Boolean);

/** True when a choice question lists the same option twice. */
const repeatsOption = (q: QuestionDraft) => {
  const options = cleanOptions(q.options);
  return new Set(options).size !== options.length;
};

/** Why a question can't be saved yet, or "". */
export const questionProblem = (q: QuestionDraft) =>
  !q.label.trim()
    ? "Give each question a label."
    : q.type !== "choice"
      ? ""
      : cleanOptions(q.options).length < 2
        ? `“${q.label.trim()}” needs at least two options.`
        : repeatsOption(q)
          ? `“${q.label.trim()}” lists the same option twice.`
          : "";

/** Extra questions on the booking form, in the order they're asked. */
export function QuestionsEditor({
  questions,
  onChange,
  disabled = false,
}: {
  disabled?: boolean;
  questions: QuestionDraft[];
  onChange: (questions: QuestionDraft[]) => void;
}) {
  const patch = (key: string, p: Partial<QuestionDraft>) =>
    !disabled &&
    onChange(questions.map((q) => (q.key === key ? { ...q, ...p } : q)));
  const move = (from: number, to: number) => {
    if (
      disabled ||
      from < 0 ||
      from >= questions.length ||
      to < 0 ||
      to >= questions.length
    )
      return;
    const next = [...questions];
    const [q] = next.splice(from, 1);
    next.splice(to, 0, q);

    onChange(next);
  };

  return (
    <>
      <Text style={[shared.small, bs.gap]}>
        Name and email are included. Add up to 10 questions.
      </Text>
      {questions.map((q, n) => {
        const name = q.label.trim() || `Question ${n + 1}`;
        return (
          <View key={q.key} style={[s.question, n > 0 && s.divided]}>
            <View style={s.head}>
              <Text style={s.number}>Question {n + 1}</Text>
              <MoreMenu
                label={`Question ${n + 1} options`}
                title={name}
                disabled={disabled}
                actions={[
                  {
                    label: "Move up",
                    disabled: disabled || n === 0,
                    onPress: () => move(n, n - 1),
                  },
                  {
                    label: "Move down",
                    disabled: disabled || n === questions.length - 1,
                    onPress: () => move(n, n + 1),
                  },
                  {
                    label: "Remove question",
                    destructive: true,
                    disabled,
                    onPress: () => {
                      if (!disabled)
                        onChange(questions.filter((x) => x.key !== q.key));
                    },
                  },
                ]}
              />
            </View>
            <Field label="Question">
              <TextInput
                editable={!disabled}
                style={shared.input}
                value={q.label}
                onChangeText={(label) => patch(q.key, { label })}
                maxLength={200}
                placeholder="What would you like to talk about?"
                placeholderTextColor={colors.faint}
                accessibilityLabel={`Question ${n + 1}`}
              />
            </Field>
            <Field label="Answer">
              <Segmented
                wrap
                disabled={disabled}
                options={QUESTION_TYPES}
                value={q.type}
                labels={TYPE_LABELS}
                accessibilityLabel={`${name} answer type`}
                onChange={(type) => {
                  patch(q.key, {
                    type,
                    options:
                      type === "choice" && q.options.length < 2
                        ? [...q.options, "", ""].slice(0, 2)
                        : q.options,
                  });
                }}
              />
            </Field>
            {q.type === "choice" && (
              <Field label="Options">
                {q.options.map((o, i) => (
                  <View key={i} style={[bs.pair, s.option]}>
                    <TextInput
                      editable={!disabled}
                      style={[shared.input, bs.half]}
                      value={o}
                      onChangeText={(text) =>
                        patch(q.key, {
                          options: q.options.map((x, j) =>
                            j === i ? text : x,
                          ),
                        })
                      }
                      maxLength={100}
                      placeholder={`Option ${i + 1}`}
                      placeholderTextColor={colors.faint}
                      accessibilityLabel={`${name} option ${i + 1}`}
                    />
                    <RemoveButton
                      disabled={disabled}
                      label={`Remove option ${i + 1}`}
                      onPress={() =>
                        patch(q.key, {
                          options: q.options.filter((_, j) => j !== i),
                        })
                      }
                    />
                  </View>
                ))}
                {repeatsOption(q) && (
                  <Text style={[shared.small, bs.warn, bs.gap]}>
                    Each option can only be listed once.
                  </Text>
                )}
                {q.options.length < MAX_OPTIONS && (
                  <View style={s.row}>
                    <SmallAction
                      label="Add option"
                      disabled={disabled}
                      onPress={() =>
                        patch(q.key, { options: [...q.options, ""] })
                      }
                    />
                  </View>
                )}
              </Field>
            )}
            <SwitchRow
              disabled={disabled}
              title="Required"
              hint="People can’t book without answering."
              value={q.required}
              onValueChange={(required) => patch(q.key, { required })}
            />
          </View>
        );
      })}
      {questions.length < MAX_QUESTIONS ? (
        <Button
          disabled={disabled}
          secondary
          title="Add a question"
          icon="plus"
          style={bs.last}
          onPress={() => {
            onChange([
              ...questions,
              {
                key: newKey(),
                id: null,
                label: "",
                type: "text",
                required: false,
                options: [],
              },
            ]);
          }}
        />
      ) : (
        <Text style={shared.small}>
          That’s the most questions a page can have.
        </Text>
      )}
    </>
  );
}

const s = themed(() =>
  StyleSheet.create({
    question: {
      paddingTop: 8,
      marginBottom: 8,
    },
    divided: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    head: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      flexWrap: "wrap",
      gap: 8,
      marginBottom: 12,
    },
    number: {
      fontFamily: fonts.semibold,
      fontSize: 13,
      color: colors.textSoft,
    },
    option: { marginBottom: 8 },
    row: { flexDirection: "row" },
  }),
);
