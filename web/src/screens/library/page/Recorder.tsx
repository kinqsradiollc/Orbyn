import { newBlockId, RECORDING_MAX_MINUTES, type DocBlock } from "@orbyn/core";
import { Mic, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { messageOf } from "../../../lib/resource";
import { client } from "../../../lib/session";
import {
  Button,
  Dialog,
  ErrorNotice,
  Loading,
  TextArea,
  useToast,
} from "../../../ui/kit";

type State = "ready" | "asking" | "on" | "saving";

/** Record asks for the microphone; Stop hands the audio to the page. */
export function Recorder({
  docId,
  onAdded,
  onClose,
}: {
  docId: string;
  onAdded: (block: DocBlock) => void;
  onClose: () => void;
}) {
  const [state, setState] = useState<State>("ready");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const parts = useRef<Blob[]>([]);
  const started = useRef(0);
  const mounted = useRef(true);
  const stopTracks = () => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  };
  const stop = () => {
    if (recorder.current?.state === "recording") {
      setState("saving");
      recorder.current.stop();
    }
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (recorder.current) {
        recorder.current.ondataavailable = null;
        recorder.current.onstop = null;
        if (recorder.current.state === "recording") recorder.current.stop();
      }
      stopTracks();
    };
  }, []);
  useEffect(() => {
    if (state !== "on") return;
    const timer = window.setInterval(() => {
      const passed = Math.floor((Date.now() - started.current) / 1000);
      setSeconds(passed);
      if (passed >= RECORDING_MAX_MINUTES * 60) stop();
    }, 500);
    return () => window.clearInterval(timer);
  }, [state]);
  const upload = async (blob: Blob, mime: string) => {
    const at = new Date();
    const name =
      `Recording ${at.toLocaleDateString([], { day: "numeric", month: "short" })} ${at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.${mime.includes("mp4") ? "m4a" : "weba"}`.replace(
        /[/:]/g,
        ".",
      );
    try {
      const { file, upload_path } = await client.createPageFile(docId, {
        name,
        bytes: blob.size,
        mime,
      });
      await client.uploadPageFile(upload_path, blob, mime);
      onAdded({
        type: "file",
        file: file.id,
        text: file.name,
        id: newBlockId(),
      });
      onClose();
    } catch (failure) {
      if (mounted.current) {
        setState("ready");
        setError(messageOf(failure, "Couldn't keep this recording."));
      }
    }
  };
  const start = async () => {
    setError("");
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices) {
      setError("Recording is unavailable in this browser.");
      return;
    }
    setState("asking");
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
    } catch {
      setState("ready");
      setError("Allow microphone access in browser settings, then retry.");
      return;
    }
    const type = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find(
      (one) => MediaRecorder.isTypeSupported?.(one),
    );
    const next = new MediaRecorder(stream.current, {
      ...(type ? { mimeType: type } : {}),
      audioBitsPerSecond: 32_000,
    });
    parts.current = [];
    next.ondataavailable = (event) => {
      if (event.data.size) parts.current.push(event.data);
    };
    next.onstop = () => {
      stopTracks();
      if (!mounted.current) return;
      const mime = (next.mimeType || type || "audio/webm").split(";")[0];
      const blob = new Blob(parts.current, { type: mime });
      if (!blob.size) {
        setState("ready");
        setError("Nothing was recorded. Try again.");
        return;
      }
      void upload(blob, mime);
    };
    recorder.current = next;
    started.current = Date.now();
    setSeconds(0);
    next.start(1000);
    setState("on");
  };
  const minutes = String(Math.floor(seconds / 60)).padStart(2, "0");
  const rest = String(seconds % 60).padStart(2, "0");
  return (
    <Dialog
      title="Record audio"
      onClose={() => state === "ready" && onClose()}
      actions={
        state === "on" ? (
          <Button variant="primary" onClick={stop}>
            <Square /> Stop and add to page
          </Button>
        ) : (
          <Button
            variant="primary"
            busy={state !== "ready"}
            onClick={() => void start()}
          >
            <Mic /> Record
          </Button>
        )
      }
    >
      {error && <ErrorNotice message={error} />}
      <p className="doc-record-time" aria-live="off">
        {minutes}:{rest}
      </p>
      <p className="small muted" role="status">
        {state === "asking"
          ? "Waiting for the microphone…"
          : state === "on"
            ? "Recording"
            : state === "saving"
              ? "Adding to the page…"
              : `Up to ${RECORDING_MAX_MINUTES} minutes.`}
      </p>
    </Dialog>
  );
}

/** The assistant's notes on a recording; each task is added on request. */
export function SummaryDialog({
  fileId,
  name,
  onClose,
  onAdd,
}: {
  fileId: string;
  name: string;
  onClose: () => void;
  onAdd: (lines: DocBlock[]) => void;
}) {
  const toast = useToast();
  const [transcript, setTranscript] = useState("");
  const [result, setResult] = useState<Awaited<
    ReturnType<typeof client.summariseRecording>
  > | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [made, setMade] = useState(new Set<number>());
  const run = async () => {
    setBusy(true);
    setError("");
    try {
      setResult(
        await client.summariseRecording(fileId, transcript.trim() || undefined),
      );
    } catch (failure) {
      setError(messageOf(failure, "Couldn't summarise this recording."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title="Summarise recording" onClose={onClose}>
      <p className="small muted" dir="auto">
        {name}
      </p>
      {error && <ErrorNotice message={error} onRetry={() => void run()} />}
      {!result ? (
        <>
          <TextArea
            aria-label="Transcript"
            placeholder="Paste a transcript if you have one"
            value={transcript}
            onChange={(event) => setTranscript(event.currentTarget.value)}
          />
          <div className="dialog-actions">
            <Button variant="ghost" onClick={onClose}>
              Not now
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
                  </span>
                  <Button
                    disabled={made.has(index)}
                    onClick={() =>
                      void client.createItem({ title: action.title }).then(
                        () => setMade((was) => new Set(was).add(index)),
                        (failure) =>
                          toast({
                            text: messageOf(failure, "Couldn't add this task."),
                            error: true,
                          }),
                      )
                    }
                  >
                    {made.has(index) ? "Added" : "Add task"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="dialog-actions">
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                onAdd([
                  {
                    type: "heading",
                    level: 2,
                    text: "Summary",
                    id: newBlockId(),
                  },
                  { type: "paragraph", text: result.summary, id: newBlockId() },
                ]);
                onClose();
              }}
            >
              Add to page
            </Button>
          </div>
        </>
      )}
    </Dialog>
  );
}
