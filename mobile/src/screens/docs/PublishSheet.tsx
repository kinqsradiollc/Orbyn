import React, { useEffect, useState } from "react";
import { StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { PUBLISH_SLUG, type PublishState } from "@orbyn/core";
import { BottomSheet } from "../../components/BottomSheet";
import { Button } from "../../components/Button";
import { client, webOrigin } from "../../lib/api";
import { confirmAction } from "../../lib/confirm";
import { errorText } from "../../lib/errors";
import { copyText } from "../../lib/share";
import { shared } from "../../styles";
import { colors, fonts, themed } from "../../theme";

/**
 * Publish to web (SHR-05, SHR-06) on a phone, for a page or a folder: off
 * until turned on, hidden from search engines unless you say otherwise, an
 * optional password and a description for the card a shared link shows.
 * Unpublish takes it off at once.
 */
export function PublishSheet({
  visible,
  kind,
  id,
  name,
  onClose,
}: {
  visible: boolean;
  kind: "doc" | "folder";
  id: string;
  name: string;
  onClose: () => void;
}) {
  const [state, setState] = useState<PublishState | null>(null);
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [hidden, setHidden] = useState(true);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const take = (s: PublishState) => {
    setState(s);
    setSlug(s.published?.slug ?? "");
    setDescription(
      kind === "doc" ? s.web_description : (s.published?.description ?? ""),
    );
    setHidden(s.published?.noindex ?? true);
    setPassword("");
  };
  useEffect(() => {
    if (!visible) return;
    setState(null);
    setError("");
    client.getPublish(kind, id).then(take, (e) => setError(errorText(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, kind, id]);
  const run = async (fn: () => Promise<PublishState>) => {
    setBusy(true);
    setError("");
    try {
      take(await fn());
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const published = state?.published ?? null;
  const url = published ? `${webOrigin}${published.path}` : "";
  const slugOk = !slug || PUBLISH_SLUG.test(slug);
  const noun = kind === "doc" ? "page" : "folder";
  const save = () =>
    void run(async () => {
      if (kind === "doc" && description !== (state?.web_description ?? ""))
        await client.setWebDescription(id, description);
      return client.publish(kind, id, {
        ...(slug ? { slug } : {}),
        noindex: hidden,
        description,
        ...(password ? { password } : {}),
      });
    });
  return (
    <BottomSheet
      visible={visible}
      title="Publish to web"
      onClose={onClose}
      footer={
        state?.can_publish ? (
          <Button
            title={published ? "Save" : "Publish"}
            disabled={busy || !slugOk || (!!password && password.length < 4)}
            onPress={save}
          />
        ) : undefined
      }
    >
      {!state && !error && <Text style={s.muted}>Loading…</Text>}
      {state && (
        <View style={s.body}>
          <Text style={s.muted}>
            {published
              ? `“${name}” is on the web. Anyone with the link can read it, without an account.`
              : `Put “${name}” on the web: anyone with the link can read it, without an account. It stays off until you publish it.`}
          </Text>
          {state.via_folder && (
            <Text style={s.note}>
              This page is on the web already, in the folder “
              {state.via_folder.folder_name}”.
            </Text>
          )}
          {!state.can_publish && !!state.reason && (
            <Text style={s.note}>{state.reason}</Text>
          )}
          {published && (
            <View style={s.linkRow}>
              <Text style={s.link} numberOfLines={1} selectable>
                {url}
              </Text>
              <Button
                secondary
                icon="copy"
                title="Copy"
                onPress={() => void copyText(url, "Link copied")}
              />
            </View>
          )}
          {state.can_publish && (
            <>
              <Text style={shared.label}>Address</Text>
              <TextInput
                style={[shared.input, !slugOk && s.invalid]}
                value={slug}
                onChangeText={(t) => setSlug(t.toLowerCase())}
                placeholder="made from the title"
                placeholderTextColor={colors.faint}
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel={`Address after ${webOrigin}/p/`}
              />
              {!slugOk && (
                <Text style={s.error}>
                  Use 3 to 80 letters, numbers and dashes.
                </Text>
              )}
              <Text style={shared.label}>Description</Text>
              <TextInput
                style={[shared.input, s.multi]}
                value={description}
                onChangeText={setDescription}
                maxLength={300}
                multiline
                placeholder="A line for the card a shared link shows"
                placeholderTextColor={colors.faint}
              />
              <View style={s.switchRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.switchTitle}>Hide from search engines</Text>
                  <Text style={s.muted}>
                    On: only people with the link find it.
                  </Text>
                </View>
                <Switch
                  value={hidden}
                  onValueChange={setHidden}
                  trackColor={{ true: colors.accent }}
                  accessibilityLabel="Hide from search engines"
                />
              </View>
              <Text style={shared.label}>
                {published?.has_password
                  ? "New password"
                  : "Password (optional)"}
              </Text>
              <TextInput
                style={shared.input}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoCapitalize="none"
                textContentType="newPassword"
                placeholder={
                  published?.has_password
                    ? "Leave empty to keep it"
                    : "Leave empty for no password"
                }
                placeholderTextColor={colors.faint}
              />
              {published?.has_password && (
                <Button
                  secondary
                  title="Remove the password"
                  disabled={busy}
                  onPress={() =>
                    void run(() =>
                      client.publish(kind, id, {
                        slug: published.slug,
                        noindex: hidden,
                        description,
                        password: null,
                      }),
                    )
                  }
                />
              )}
            </>
          )}
          {published && (
            <>
              <Text style={s.muted}>
                Read {published.views} time{published.views === 1 ? "" : "s"}.
              </Text>
              <Button
                destructive
                title="Unpublish"
                disabled={busy}
                onPress={() =>
                  confirmAction(
                    `Unpublish this ${noun}?`,
                    "The address stops working at once. You can publish it again later.",
                    "Unpublish",
                    () => void run(() => client.unpublish(kind, id)),
                  )
                }
              />
            </>
          )}
        </View>
      )}
      {!!error && <Text style={s.error}>{error}</Text>}
    </BottomSheet>
  );
}

/**
 * A team's switch for publishing (SHR-05): owners and admins can turn it
 * off, which takes every one of the team's pages off the web at once.
 */
export function TeamPublishingRow({ teamId }: { teamId: string }) {
  const [state, setState] = useState<{
    allowed: boolean;
    published: number;
    can_change: boolean;
  } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    client.getTeamPublishing(teamId).then(setState, () => setState(null));
  }, [teamId]);
  if (!state) return null;
  return (
    <View style={[shared.card, s.team]}>
      <View style={s.switchRow}>
        <View style={{ flex: 1 }}>
          <Text style={s.switchTitle}>Members can publish pages</Text>
          <Text style={s.muted}>
            {state.published
              ? `${state.published} published. `
              : "Nothing published. "}
            {state.can_change
              ? "Off takes them all off the web at once."
              : "Owners and admins can change this."}
          </Text>
        </View>
        <Switch
          value={state.allowed}
          disabled={!state.can_change}
          trackColor={{ true: colors.accent }}
          accessibilityLabel="Members can publish the team's pages"
          onValueChange={(on) =>
            client.setTeamPublishing(teamId, on).then(
              (next) => {
                setError("");
                setState(next);
              },
              (e) => setError(errorText(e)),
            )
          }
        />
      </View>
      {!!error && <Text style={s.error}>{error}</Text>}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    body: { gap: 10, paddingBottom: 8 },
    muted: {
      fontFamily: fonts.regular,
      fontSize: 13,
      lineHeight: 18,
      color: colors.muted,
    },
    note: {
      padding: 10,
      borderRadius: 10,
      overflow: "hidden",
      backgroundColor: colors.surfaceMuted,
      fontFamily: fonts.regular,
      fontSize: 13,
      color: colors.textSoft,
    },
    linkRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    link: {
      flex: 1,
      fontFamily: fonts.regular,
      fontSize: 15,
      color: colors.accent,
    },
    invalid: { borderColor: colors.danger },
    multi: { minHeight: 64, textAlignVertical: "top" },
    switchRow: { flexDirection: "row", alignItems: "center", gap: 12 },
    switchTitle: { fontFamily: fonts.medium, fontSize: 15, color: colors.text },
    error: { fontFamily: fonts.regular, fontSize: 13, color: colors.danger },
    team: { gap: 6 },
  }),
);
