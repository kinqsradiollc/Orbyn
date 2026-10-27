import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { Switch } from "../../components/Switch";
import { PUBLISH_SLUG, type PublishState } from "@orbyn/core";
import { BottomSheet } from "../../components/BottomSheet";
import { Button } from "../../components/Button";
import { client, webOrigin } from "../../lib/api";
import { ActionSheet, MoreMenu } from "../../components/MoreMenu";
import { session } from "../../lib/session";
import { errorText } from "../../lib/errors";
import { copyText } from "../../lib/share";
import { shared } from "../../styles";
import { colors, fonts, radii, themed } from "../../theme";
import { PagePublicationSheet } from "./PagePublicationSheet";

export function PublishSheet(props: {
  visible: boolean;
  kind: "doc" | "folder";
  id: string;
  name: string;
  onClose: () => void;
}) {
  return props.kind === "doc" ? (
    props.visible ? (
      <PagePublicationSheet id={props.id} onClose={props.onClose} />
    ) : null
  ) : props.visible ? (
    <LegacyPublishSheet
      key={`${session.token}:${props.kind}:${props.id}`}
      {...props}
    />
  ) : null;
}

/**
 * Publish to web (SHR-05, SHR-06) on a phone, for a page or a folder: off
 * until turned on, hidden from search engines unless you say otherwise, an
 * optional password and a description for the card a shared link shows.
 * Unpublish takes it off at once.
 */
function LegacyPublishSheet({
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
  const [note, setNote] = useState("");
  const [leavePrompt, setLeavePrompt] = useState(false);
  const [unpublishPrompt, setUnpublishPrompt] = useState(false);
  const [removePasswordPrompt, setRemovePasswordPrompt] = useState(false);
  const owner = useRef(session.token);
  const mounted = useRef(false);
  const lock = useRef(false);
  const baseline = useRef("");
  const owns = () => mounted.current && owner.current === session.token;
  const close = () => {
    if (lock.current || !owns()) return;
    if (
      state &&
      baseline.current !== JSON.stringify([slug, description, hidden, password])
    )
      setLeavePrompt(true);
    else onClose();
  };
  const take = (s: PublishState) => {
    setState(s);
    setSlug(s.published?.slug ?? "");
    setDescription(
      kind === "doc" ? s.web_description : (s.published?.description ?? ""),
    );
    setHidden(s.published?.noindex ?? true);
    setPassword("");
    baseline.current = JSON.stringify([
      s.published?.slug ?? "",
      kind === "doc" ? s.web_description : (s.published?.description ?? ""),
      s.published?.noindex ?? true,
      "",
    ]);
  };
  const load = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const next = await client.getPublish(kind, id);
      if (owns()) take(next);
    } catch (e) {
      if (owns()) setError(errorText(e));
    } finally {
      lock.current = false;
      if (owns()) setBusy(false);
    }
  };
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, []);
  const run = async (fn: () => Promise<PublishState>) => {
    if (lock.current || !owns()) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNote("");
    try {
      const next = await fn();
      if (owns()) {
        take(next);
        setNote(next.published ? "Publishing saved." : "Unpublished.");
      }
    } catch (e) {
      if (owns()) setError(errorText(e));
    } finally {
      lock.current = false;
      if (owns()) setBusy(false);
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
    <>
      <BottomSheet
        visible={visible}
        title="Publish to web"
        onClose={close}
        closeDisabled={busy}
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
                ? `“${name}” is published. ${published.has_password ? "Password required to read it." : "Anyone with the link can read it."}`
                : `“${name}” stays private until published. ${password ? "Readers will need the password." : "Anyone with the link will be able to read it."}`}
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
                <Text style={s.link} selectable>
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
                  editable={!busy}
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
                  editable={!busy}
                  value={description}
                  onChangeText={setDescription}
                  maxLength={300}
                  multiline
                  placeholder="Short link preview"
                  placeholderTextColor={colors.faint}
                />
                <View style={s.switchRow}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.switchTitle}>Hide from search engines</Text>
                    <Text style={s.muted}>
                      Requests exclusion from search results. Access settings
                      are unchanged.
                    </Text>
                  </View>
                  <Switch
                    disabled={busy}
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
                  editable={!busy}
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
              </>
            )}
            {published && (
              <>
                <Text style={s.muted}>
                  Read {published.views} time{published.views === 1 ? "" : "s"}.
                </Text>
                <MoreMenu
                  label="Publishing options"
                  disabled={busy}
                  actions={[
                    ...(published.has_password && state.can_publish
                      ? [
                          {
                            label: "Remove password",
                            destructive: true,
                            onPress: () => {
                              if (owns() && !lock.current)
                                setRemovePasswordPrompt(true);
                            },
                          },
                        ]
                      : []),
                    {
                      label: "Unpublish",
                      destructive: true,
                      onPress: () => {
                        if (owns() && !lock.current) setUnpublishPrompt(true);
                      },
                    },
                  ]}
                />
              </>
            )}
          </View>
        )}
        {!!error && (
          <Text accessibilityRole="alert" style={s.error}>
            {error}
          </Text>
        )}
        {!state && error && (
          <Button
            title="Retry"
            secondary
            disabled={busy}
            onPress={() => void load()}
          />
        )}
        {!!note && (
          <Text accessibilityRole="text" style={s.muted}>
            {note}
          </Text>
        )}
      </BottomSheet>
      <ActionSheet
        visible={leavePrompt}
        label="Unsaved publishing changes"
        title="Discard changes?"
        cancelLabel="Keep editing"
        onClose={() => setLeavePrompt(false)}
        actions={[
          {
            label: "Discard changes",
            destructive: true,
            onPress: () => {
              if (owns() && !lock.current) onClose();
            },
          },
        ]}
      />
      <ActionSheet
        visible={removePasswordPrompt}
        label="Remove publishing password"
        title="Remove password?"
        message="Anyone with the public link will be able to read this folder."
        onClose={() => setRemovePasswordPrompt(false)}
        actions={[
          {
            label: "Remove password",
            destructive: true,
            disabled: busy,
            onPress: () => {
              if (published && state?.can_publish)
                void run(() =>
                  client.publish(kind, id, {
                    slug: published.slug,
                    noindex: hidden,
                    description,
                    password: null,
                  }),
                );
            },
          },
        ]}
      />
      <ActionSheet
        visible={unpublishPrompt}
        label="Unpublish"
        title={`Unpublish this ${noun}?`}
        message="The public address stops working. You can publish it again later."
        onClose={() => setUnpublishPrompt(false)}
        actions={[
          {
            label: "Unpublish",
            destructive: true,
            disabled: busy,
            onPress: () => void run(() => client.unpublish(kind, id)),
          },
        ]}
      />
    </>
  );
}

/**
 * A team's switch for publishing (SHR-05): owners and admins can turn it
 * off, which takes every one of the team's pages off the web at once.
 */
export function TeamPublishingRow({ teamId }: { teamId: string }) {
  return (
    <TeamPublishingRowBody key={`${session.token}:${teamId}`} teamId={teamId} />
  );
}
function TeamPublishingRowBody({ teamId }: { teamId: string }) {
  const [state, setState] = useState<{
    allowed: boolean;
    published: number;
    can_change: boolean;
  } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const owner = useRef(session.token);
  const mounted = useRef(false);
  const lock = useRef(false);
  const owns = () => mounted.current && owner.current === session.token;
  const load = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const next = await client.getTeamPublishing(teamId);
      if (owns()) setState(next);
    } catch (e) {
      if (owns()) setError(errorText(e));
    } finally {
      lock.current = false;
      if (owns()) setBusy(false);
    }
  };
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, []);
  const change = async (allowed: boolean) => {
    if (!state?.can_change || lock.current || !owns()) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const next = await client.setTeamPublishing(teamId, allowed);
      if (owns()) setState(next);
    } catch (e) {
      if (owns()) setError(errorText(e));
    } finally {
      lock.current = false;
      if (owns()) setBusy(false);
    }
  };
  return (
    <View style={s.team}>
      <Text style={s.switchTitle}>Pages on the web</Text>
      {!state && !error && (
        <Text style={s.muted}>Loading publishing settings…</Text>
      )}
      {state && (
        <View style={s.switchRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.switchTitle}>Members can publish pages</Text>
            <Text style={s.muted}>
              {state.published} published.{" "}
              {state.can_change
                ? "Turning this off removes all public team pages."
                : "Owners and admins can change this."}
            </Text>
          </View>
          <Switch
            value={state.allowed}
            disabled={busy || !state.can_change}
            accessibilityLabel="Members can publish pages"
            onValueChange={(value) => void change(value)}
          />
        </View>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={s.error}>
          {error}
        </Text>
      )}
      {!state && error && (
        <Button
          title="Retry"
          secondary
          disabled={busy}
          onPress={() => void load()}
        />
      )}
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
      borderRadius: radii.input,
      overflow: "hidden",
      backgroundColor: colors.surfaceMuted,
      fontFamily: fonts.regular,
      fontSize: 13,
      color: colors.textSoft,
    },
    linkRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 8,
    },
    link: {
      flexGrow: 1,
      flexBasis: 180,
      minWidth: 0,
      fontFamily: fonts.regular,
      fontSize: 15,
      color: colors.accent,
    },
    invalid: { borderColor: colors.danger },
    multi: { minHeight: 64, maxHeight: 160, textAlignVertical: "top" },
    switchRow: { flexDirection: "row", alignItems: "center", gap: 12 },
    switchTitle: { fontFamily: fonts.medium, fontSize: 15, color: colors.text },
    error: { fontFamily: fonts.regular, fontSize: 13, color: colors.danger },
    team: { gap: 6 },
  }),
);
