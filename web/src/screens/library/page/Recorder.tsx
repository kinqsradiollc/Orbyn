import { newBlockId, RECORDING_MAX_MINUTES, type DocBlock } from "@orbyn/core";
import { Mic, Square } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { messageOf } from "../../../lib/resource";
import { client, onToken } from "../../../lib/session";
import {
  Button,
  Dialog,
  ErrorNotice,
  Loading,
  TextArea,
  useConfirm,
} from "../../../ui/kit";
import { fileOwnerGeneration } from "./files";

type State = "ready" | "asking" | "on" | "saving" | "captured";
type Recording = {
  blob: Blob;
  mime: string;
  name: string;
  blockId: string;
  upload?: Awaited<ReturnType<typeof client.createPageFile>>;
  uploaded?: boolean;
};
type RecorderProps = {
  docId: string;
  onAdded: (block: DocBlock) => void;
  onClose: () => void;
};

export function Recorder(props: RecorderProps) {
  const owner = useSyncExternalStore(onToken, fileOwnerGeneration);
  return <RecorderBody key={`${owner}:${props.docId}`} {...props} />;
}

/** Capture and upload are separate: a failed upload retains the recorded bytes. */
function RecorderBody({ docId, onAdded, onClose }: RecorderProps) {
  const confirm = useConfirm();
  const [state, setState] = useState<State>("ready");
  const stateRef = useRef<State>("ready");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const parts = useRef<Blob[]>([]);
  const recording = useRef<Recording | null>(null);
  const started = useRef(0);
  const mounted = useRef(true);
  const owner = useRef(fileOwnerGeneration()).current;
  const generation = useRef(0);
  const uploadLock = useRef(false);
  const added = useRef(false);
  const current = (ticket = generation.current) =>
    mounted.current &&
    ticket === generation.current &&
    owner === fileOwnerGeneration();
  const transition = (next: State) => {
    stateRef.current = next;
    setState(next);
  };
  const stopTracks = () => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  };
  const release = () => {
    const active = recorder.current;
    recorder.current = null;
    if (active) {
      active.ondataavailable = null;
      active.onstop = null;
      active.onerror = null;
      if (active.state !== "inactive") {
        try {
          active.stop();
        } catch {
          /* Tracks are released below even if stop fails. */
        }
      }
    }
    stopTracks();
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
      release();
    };
  }, []);

  const upload = async () => {
    const captured = recording.current;
    if (!captured || uploadLock.current || !current() || added.current) return;
    uploadLock.current = true;
    const ticket = generation.current;
    transition("saving");
    setError("");
    try {
      // Reconcile a lost upload response before reusing its single-use URL.
      if (captured.upload && !captured.uploaded) {
        try {
          const result = await client.pageFile(captured.upload.file.id);
          if (!current(ticket)) return;
          captured.uploaded = result.file.status === "ready";
        } catch {
          /* A waiting upload may have no downloadable link yet. */
        }
      }
      if (!current(ticket)) return;
      if (!captured.upload) {
        captured.upload = await client.createPageFile(docId, {
          name: captured.name,
          bytes: captured.blob.size,
          mime: captured.mime,
        });
      }
      if (!current(ticket)) return;
      if (!captured.uploaded) {
        await client.uploadPageFile(
          captured.upload.upload_path,
          captured.blob,
          captured.mime,
        );
        captured.uploaded = true;
      }
      if (!current(ticket) || added.current) return;
      onAdded({
        type: "file",
        file: captured.upload.file.id,
        text: captured.name,
        id: captured.blockId,
      });
      added.current = true;
      recording.current = null;
      onClose();
    } catch (failure) {
      if (current(ticket)) {
        transition("captured");
        setError(
          messageOf(
            failure,
            "Couldn't add the recording. Retry or save it to your device.",
          ),
        );
      }
    } finally {
      uploadLock.current = false;
    }
  };
  const stop = () => {
    const active = recorder.current;
    if (
      !current() ||
      stateRef.current !== "on" ||
      !active ||
      active.state !== "recording"
    )
      return;
    transition("saving");
    try {
      active.stop();
    } catch (failure) {
      release();
      transition("ready");
      setError(
        messageOf(failure, "Couldn't finish this recording. Try again."),
      );
    }
  };
  useEffect(() => {
    if (state !== "on") return;
    const timer = window.setInterval(() => {
      const passed = Math.floor((Date.now() - started.current) / 1000);
      setSeconds(passed);
      if (passed >= RECORDING_MAX_MINUTES * 60) stop();
    }, 500);
    return () => window.clearInterval(timer);
  }, [state]);

  const start = async () => {
    if (stateRef.current !== "ready" || !current()) return;
    setError("");
    if (
      typeof MediaRecorder === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setError("Recording is unavailable in this browser.");
      return;
    }
    transition("asking");
    const ticket = ++generation.current;
    try {
      const acquired = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      if (!current(ticket)) {
        acquired.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = acquired;
      const type = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find(
        (one) => MediaRecorder.isTypeSupported?.(one),
      );
      const active = new MediaRecorder(acquired, {
        ...(type ? { mimeType: type } : {}),
        audioBitsPerSecond: 32_000,
      });
      recorder.current = active;
      parts.current = [];
      active.ondataavailable = (event) => {
        if (current(ticket) && event.data.size) parts.current.push(event.data);
      };
      active.onerror = () => {
        if (!current(ticket)) return;
        release();
        transition("ready");
        setError("The microphone stopped unexpectedly. Try recording again.");
      };
      active.onstop = () => {
        stopTracks();
        recorder.current = null;
        if (!current(ticket)) return;
        const mime = (active.mimeType || type || "audio/webm").split(";")[0];
        const blob = new Blob(parts.current, { type: mime });
        if (!blob.size) {
          transition("ready");
          setError("Nothing was recorded. Try again.");
          return;
        }
        const date = new Date();
        recording.current = {
          blob,
          mime,
          blockId: newBlockId(),
          name: `Recording ${date.toISOString().replace(/[:.]/g, "-")}.${mime.includes("mp4") ? "m4a" : "weba"}`,
        };
        transition("captured");
        void upload();
      };
      active.start(1000);
      started.current = Date.now();
      setSeconds(0);
      transition("on");
    } catch (failure) {
      release();
      if (current(ticket)) {
        transition("ready");
        setError(
          failure instanceof DOMException &&
            ["NotAllowedError", "PermissionDeniedError"].includes(failure.name)
            ? "Allow microphone access in browser settings, then retry."
            : messageOf(failure, "Couldn't start recording. Try again."),
        );
      }
    }
  };
  const close = async () => {
    if (stateRef.current === "saving") return;
    if (
      (stateRef.current === "on" || recording.current) &&
      !(await confirm({
        title: "Discard this recording?",
        body: "The audio hasn't been added to the page.",
        action: "Discard",
        danger: true,
      }))
    )
      return;
    if (!current()) return;
    generation.current++;
    release();
    recording.current = null;
    onClose();
  };
  const keepLocal = () => {
    const captured = recording.current;
    if (!captured) return;
    const url = URL.createObjectURL(captured.blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = captured.name;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <Dialog
      title="Record audio"
      onClose={() => void close()}
      actions={
        <>
          <Button
            variant="ghost"
            disabled={state === "saving"}
            onClick={() => void close()}
          >
            Cancel
          </Button>
          {state === "on" ? (
            <Button variant="primary" onClick={stop}>
              <Square /> Stop and add to page
            </Button>
          ) : state === "captured" ? (
            <>
              <Button onClick={keepLocal}>Save recording to device</Button>
              <Button variant="primary" onClick={() => void upload()}>
                Retry adding recording
              </Button>
            </>
          ) : (
            <Button
              variant="primary"
              busy={state === "asking" || state === "saving"}
              onClick={() => void start()}
            >
              <Mic /> Record
            </Button>
          )}
        </>
      }
    >
      {error && <ErrorNotice message={error} />}
      <p className="doc-record-time" aria-live="off">
        {String(Math.floor(seconds / 60)).padStart(2, "0")}:
        {String(seconds % 60).padStart(2, "0")}
      </p>
      <p className="small muted" role="status">
        {state === "asking"
          ? "Waiting for the microphone…"
          : state === "on"
            ? "Recording"
            : state === "saving"
              ? "Adding to the page…"
              : state === "captured"
                ? "Your recording is kept here until you add it or leave."
                : `Up to ${RECORDING_MAX_MINUTES} minutes.`}
      </p>
    </Dialog>
  );
}

type SummaryProps = {
  fileId: string;
  name: string;
  onClose: () => void;
  onAdd: (lines: DocBlock[]) => void;
};
export function SummaryDialog(props: SummaryProps) {
  const owner = useSyncExternalStore(onToken, fileOwnerGeneration);
  return <SummaryBody key={`${owner}:${props.fileId}`} {...props} />;
}

/** Provider failure retains the transcript; keeping it manually remains available. */
function SummaryBody({ fileId, name, onClose, onAdd }: SummaryProps) {
  const confirm = useConfirm();
  const [transcript, setTranscript] = useState("");
  const [result, setResult] = useState<Awaited<
    ReturnType<typeof client.summariseRecording>
  > | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [made, setMade] = useState(new Set<number>());
  const madeRef = useRef(new Set<number>());
  const [pending, setPending] = useState(new Set<number>());
  const tasks = useRef(new Set<number>());
  const keys = useRef(new Map<number, string>());
  const running = useRef(false);
  const appended = useRef(false);
  const mounted = useRef(true);
  const owner = useRef(fileOwnerGeneration()).current;
  const current = () => mounted.current && owner === fileOwnerGeneration();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const locked = busy || pending.size > 0;
  const run = async () => {
    if (running.current || tasks.current.size || !current()) return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      const value = await client.summariseRecording(
        fileId,
        transcript.trim() || undefined,
      );
      if (current()) setResult(value);
    } catch (failure) {
      if (current())
        setError(
          messageOf(
            failure,
            "Couldn't summarise this recording. Your transcript is kept.",
          ),
        );
    } finally {
      running.current = false;
      if (current()) setBusy(false);
    }
  };
  const makeTask = async (index: number) => {
    const action = result?.actions[index];
    if (
      !action ||
      madeRef.current.has(index) ||
      tasks.current.has(index) ||
      !current()
    )
      return;
    tasks.current.add(index);
    setPending(new Set(tasks.current));
    setError("");
    try {
      const due = action.due ? new Date(`${action.due}T17:00:00`) : null;
      if (due && !Number.isFinite(due.getTime()))
        throw new Error(
          "This suggested deadline isn't valid. Add the task manually.",
        );
      let key = keys.current.get(index);
      if (!key) {
        key = crypto.randomUUID();
        keys.current.set(index, key);
      }
      await client.once(key, () =>
        client.createItem({
          title: action.title,
          kind: "task",
          ...(due ? { due_at: due.toISOString() } : {}),
        }),
      );
      if (current()) {
        madeRef.current.add(index);
        setMade(new Set(madeRef.current));
      }
    } catch (failure) {
      if (current())
        setError(messageOf(failure, "Couldn't add this task. Try again."));
    } finally {
      tasks.current.delete(index);
      if (current()) setPending(new Set(tasks.current));
    }
  };
  const append = (heading: string, text: string) => {
    if (
      running.current ||
      tasks.current.size ||
      appended.current ||
      !text.trim() ||
      !current()
    )
      return;
    appended.current = true;
    try {
      onAdd([
        { type: "heading", level: 2, text: heading, id: newBlockId() },
        { type: "paragraph", text, id: newBlockId() },
      ]);
      onClose();
    } catch (failure) {
      appended.current = false;
      setError(
        messageOf(failure, "Couldn't add these notes. Your draft is kept."),
      );
    }
  };
  const close = async () => {
    if (running.current || tasks.current.size) return;
    if (
      (transcript.trim() || result) &&
      !(await confirm({
        title: "Close recording notes?",
        body: "Notes not added to the page will be discarded. Tasks already added stay.",
        action: "Close",
      }))
    )
      return;
    if (current()) onClose();
  };
  return (
    <Dialog title="Summarise recording" onClose={() => void close()}>
      <p className="small muted" dir="auto">
        {name}
      </p>
      {error && <ErrorNotice message={error} />}
      {!result ? (
        <>
          <p className="small muted">
            Use your selected AI to summarise, or keep a transcript on the page
            yourself.
          </p>
          <TextArea
            aria-label="Transcript"
            placeholder="Paste a transcript if you have one"
            maxLength={200000}
            disabled={locked}
            value={transcript}
            onChange={(event) => setTranscript(event.currentTarget.value)}
          />
          <div className="dialog-actions">
            <Button
              variant="ghost"
              disabled={locked}
              onClick={() => void close()}
            >
              Not now
            </Button>
            <Button
              disabled={locked || !transcript.trim()}
              onClick={() => append("Transcript", transcript)}
            >
              Add transcript to page
            </Button>
            <Button variant="primary" busy={busy} onClick={() => void run()}>
              Summarise
            </Button>
          </div>
          {busy && <Loading label="Summarising" />}
        </>
      ) : (
        <>
          <p dir="auto">{result.summary}</p>
          {result.actions.length > 0 && (
            <ul className="lib-picklist">
              {result.actions.map((action, index) => (
                <li key={index} className="row">
                  <span className="row-main" dir="auto">
                    {action.title}
                    {action.due && (
                      <span className="small muted">Due {action.due}</span>
                    )}
                  </span>
                  <Button
                    disabled={made.has(index)}
                    busy={pending.has(index)}
                    onClick={() => void makeTask(index)}
                  >
                    {made.has(index) ? "Added" : "Add task"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="dialog-actions">
            <Button
              variant="ghost"
              disabled={locked}
              onClick={() => void close()}
            >
              Close
            </Button>
            <Button
              variant="primary"
              disabled={locked}
              onClick={() => append("Summary", result.summary)}
            >
              Add to page
            </Button>
          </div>
        </>
      )}
    </Dialog>
  );
}
