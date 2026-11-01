import { inspectProfile } from "./receipts";
import { useEffect, useRef, useState } from "react";
import { profileInput, type Profile } from "@orbyn/core";
import { client } from "../../lib/session";
import { Button, Field, Input, TextArea } from "../../ui/kit";
import {
  CommandState,
  ReadState,
  matches,
  requireReceipt,
  useCommand,
  useExit,
  useRead,
} from "./shared";
import { CopyButton } from "./sharing";
export function ProfileEditor() {
  const last = useRef<Profile | undefined>(undefined),
    read = useRead(() => client.getProfile());
  if (read.data) last.current = read.data;
  const shown = read.data ?? last.current;
  return (
    <section>
      <h2>Public profile</h2>
      <p>
        A handle publishes your name, bio and active public booking pages.
        Turning off the profile does not pause its individual booking pages.
      </p>
      <ReadState read={read}>
        {shown && (
          <Editor
            value={shown}
            visible={!!read.data}
            fresh={read.fresh}
            accept={read.commit}
          />
        )}
      </ReadState>
      <Button disabled={read.loading} onClick={() => void read.reload()}>
        Refresh saved profile
      </Button>
    </section>
  );
}
function Editor({
  value,
  fresh,
  accept,
  visible,
}: {
  value: Profile;
  fresh: boolean;
  accept: (value: Profile) => void;
  visible: boolean;
}) {
  const op = useCommand(),
    previous = useRef(value),
    [conflict, setConflict] = useState(false),
    [observed, setObserved] = useState<Profile | null>(null),
    [handle, setHandle] = useState(value.handle || ""),
    [bio, setBio] = useState(value.bio),
    dirty = handle !== (value.handle || "") || bio !== value.bio,
    attempt = useRef<{ handle?: string | null; bio?: string } | null>(null);
  useExit({ dirty });
  useEffect(() => {
    const p = previous.current;
    const localHandle = handle !== (p.handle || ""),
      localBio = bio !== p.bio;
    if (
      (localHandle && p.handle !== value.handle) ||
      (localBio && p.bio !== value.bio)
    )
      setConflict(true);
    setHandle((h) => (h === (p.handle || "") ? value.handle || "" : h));
    setBio((b) => (b === p.bio ? value.bio : b));
    previous.current = value;
  }, [value.handle, value.bio]);
  function save(disable = false) {
    if (!fresh || conflict || (disable && dirty)) {
      op.reject(
        "Refresh or explicitly review the retained profile draft before saving.",
      );
      return;
    }
    const parsed = profileInput.safeParse(
      disable ? { handle: null } : { handle: handle.trim() || null, bio },
    );
    if (!parsed.success) {
      op.reject(parsed.error.issues[0]?.message || "Check profile details.");
      return;
    }
    const body = parsed.data;
    void op.run(
      () => {
        attempt.current = body;
        return client.updateProfile(body);
      },
      (r) => {
        requireReceipt(r, body);
        previous.current = r;
        setConflict(false);
        accept(r);
        setHandle(r.handle || "");
        setBio(r.bio);
      },
      disable
        ? {
            title: "Turn off your public profile?",
            body: "The /u/ address will stop showing your profile. Individual active booking pages remain public.",
            action: "Turn off profile",
            danger: true,
          }
        : {
            title: body.handle
              ? "Publish profile changes?"
              : "Save private profile settings?",
            body: body.handle
              ? "Your name, bio and active booking pages will be public."
              : "Your public profile is turned off.",
            action: "Save profile",
          },
    );
  }
  async function check() {
    const body = attempt.current;
    if (!body) return false;
    const r = await inspectProfile();
    if (!op.owner()) return false;
    setObserved(r);
    // This endpoint has no operation receipt or version fence: inspect without unlocking.
    return false;
  }
  if (!visible)
    return (
      <>
        <p>
          The saved profile is currently unavailable. Your local draft is kept
          for copying.
        </p>
        <CopyButton
          text={JSON.stringify({ handle, bio }, null, 2)}
          label="Copy retained profile draft"
        />
        <CommandState op={op} check={check} />
      </>
    );
  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <fieldset disabled={op.blocked || !fresh}>
          <Field
            label="Public handle (blank turns the profile off)"
            hint="3–40 lowercase letters, numbers and single dashes; reserved names are refused."
          >
            <Input
              value={handle}
              maxLength={40}
              onChange={(e) => setHandle(e.target.value)}
            />
          </Field>
          <Field label="Bio">
            <TextArea
              maxLength={300}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
            />
          </Field>
          <Button type="submit" variant="primary" disabled={!dirty || conflict}>
            Save profile
          </Button>
        </fieldset>
      </form>
      {value.url && (
        <>
          <p className="booking-web-wrap">{value.url}</p>
          <CopyButton text={value.url} label="Copy public profile URL" />
          <a
            className="btn btn-ghost"
            target="_blank"
            rel="noreferrer"
            href={
              new URL(
                "/u/" + encodeURIComponent(value.handle || ""),
                location.origin,
              ).href
            }
          >
            View published profile
          </a>
          <Button
            variant="danger"
            disabled={op.blocked || !fresh || dirty || conflict}
            onClick={() => save(true)}
          >
            Turn off profile
          </Button>
        </>
      )}
      {conflict && (
        <p role="alert">
          The saved profile changed while you were editing. Your draft is kept.
          Copy it or explicitly use the saved values before another save.
        </p>
      )}
      <CopyButton
        text={JSON.stringify({ handle, bio }, null, 2)}
        label="Copy profile draft"
      />
      <Button
        disabled={op.blocked || (!dirty && !conflict)}
        onClick={() => {
          setHandle(value.handle || "");
          setBio(value.bio);
          setConflict(false);
        }}
      >
        Discard draft and use saved profile
      </Button>
      {observed && (
        <section>
          <h3>Latest saved profile</h3>
          <p>Handle: {observed.handle || "off"}</p>
          <p dir="auto">{observed.bio}</p>
          <p>
            The original save remains unconfirmed. This read does not authorize
            a replay or another write.
          </p>
        </section>
      )}
      <CommandState op={op} check={check} />
    </>
  );
}
