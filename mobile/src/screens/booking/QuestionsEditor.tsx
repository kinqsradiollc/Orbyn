import React from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { QUESTION_TYPES, type BookingQuestion } from "@orbyn/core";
import { Button } from "../../components/Button";
import { Field } from "../../components/Field";
import { Segmented } from "../../components/Segmented";
import { SmallAction } from "../../components/SmallAction";
import { animateLayout } from "../../motion";
import { colors, fonts } from "../../theme";
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

/** Why a question can't be saved yet, or "". */
export const questionProblem = (q: QuestionDraft) =>
  !q.label.trim()
    ? "Give each question a label."
    : q.type === "choice" && q.options.filter((o) => o.trim()).length < 2
      ? `“${q.label.trim()}” needs at least two options.`
      : "";

/** Extra questions on the booking form, in the order they're asked. */
export function QuestionsEditor({
  questions,
  onChange,
}: {
  questions: QuestionDraft[];
  onChange: (questions: QuestionDraft[]) => void;
}) {
  const patch = (key: string, p: Partial<QuestionDraft>) =>
    onChange(questions.map((q) => (q.key === key ? { ...q, ...p } : q)));
  const move = (from: number, to: number) => {
    const next = [...questions];
    const [q] = next.splice(from, 1);
    next.splice(to, 0, q);
    animateLayout();
    onChange(next);
  };

  return (
    <>
      <Text style={[shared.small, bs.gap]}>
        People always give their name and email. Add anything else you need to
        know before you meet.
      </Text>
      {questions.map((q, n) => {
        const name = q.label.trim() || `Question ${n + 1}`;
        return (
          <View key={q.key} style={s.question}>
            <View style={s.head}>
              <Text style={s.number}>Question {n + 1}</Text>
              <View style={s.moves}>
                <SmallAction
                  label="Up"
                  disabled={n === 0}
                  onPress={() => move(n, n - 1)}
                />
                <SmallAction
                  label="Down"
                  disabled={n === questions.length - 1}
                  onPress={() => move(n, n + 1)}
                />
                <SmallAction
                  destructive
                  label="Remove"
                  disabled={false}
                  onPress={() => {
                    animateLayout();
                    onChange(questions.filter((x) => x.key !== q.key));
                  }}
                />
              </View>
            </View>
            <Field label="Question">
              <TextInput
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
                options={QUESTION_TYPES}
                value={q.type}
                labels={TYPE_LABELS}
                accessibilityLabel={`${name} answer type`}
                onChange={(type) => {
                  animateLayout();
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
                      label={`Remove option ${i + 1}`}
                      onPress={() =>
                        patch(q.key, {
                          options: q.options.filter((_, j) => j !== i),
                        })
                      }
                    />
                  </View>
                ))}
                {q.options.length < MAX_OPTIONS && (
                  <View style={s.row}>
                    <SmallAction
                      label="Add option"
                      disabled={false}
                      onPress={() =>
                        patch(q.key, { options: [...q.options, ""] })
                      }
                    />
                  </View>
                )}
              </Field>
            )}
            <SwitchRow
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
          secondary
          title="Add a question"
          icon="plus"
          style={bs.last}
          onPress={() => {
            animateLayout();
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

const s = StyleSheet.create({
  question: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    paddingBottom: 0,
    marginBottom: 12,
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
  },
  number: { fontFamily: fonts.semibold, fontSize: 13, color: colors.textSoft },
  moves: { flexDirection: "row", gap: 6 },
  option: { marginBottom: 8 },
  row: { flexDirection: "row" },
});
