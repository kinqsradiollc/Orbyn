import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useModalFocus } from "../../hooks/useModalFocus";
import { Loader2, Mic, Square, Sparkles, X } from "lucide-react";
import {
  RECORDING_CONSENT,
  RECORDING_MAX_MINUTES,
  recordingClock,
  summaryLines,
  aiFeatureProviderLabel,
  type DocBlock,
  type RecordingSummary,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { errorText } from "../../lib/errors";
import "./record.css";

/**
 * Record audio into a page (CAP-10). The sheet says first what happens to
 * the recording; Record asks for the microphone, and Stop hands the audio
 * to the page, which keeps it in Orbyn's own file store like any file.
 */
export function Recorder({
  onDone,
  onClose,
}: {
  /** The recording, as a file to add to the page. */
  onDone: (file: File) => void;
  onClose: () => void;
}) {
  const [state, setState] = useState<"ready" | "asking" | "on" | "saving">(
    "ready",
  );
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const mounted = useRef(true);
  const starting = useRef(false);
  const focus = useModalFocus(onClose, state !== "ready");
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const parts = useRef<Blob[]>([]);
  const started = useRef(0);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  const stopTracks = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };
  useEffect(() => {
    mounted.current = true;
    const dialog = focus.ref.current as HTMLDialogElement | null;
    dialog?.showModal();
    return () => {
      mounted.current = false;
      if (recorder.current) {
        recorder.current.ondataavailable = null;
        recorder.current.onstop = null;
        if (recorder.current.state === "recording") recorder.current.stop();
      }
      stopTracks();
      dialog?.close();
    };
  }, []);
  useEffect(() => {
    if (state !== "on") return;
    const t = window.setInterval(() => {
      const s = Math.floor((Date.now() - started.current) / 1000);
      setSeconds(s);
      if (s >= RECORDING_MAX_MINUTES * 60) stop();
    }, 500);
    return () => window.clearInterval(t);
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = async () => {
    if (starting.current || state !== "ready") return;
    starting.current = true;
    setError("");
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices) {
      setError("Recording is unavailable in this browser.");
      starting.current = false;
      return;
    }
    setState("asking");
    try {
      const acquired = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      if (!mounted.current) {
        acquired.getTracks().forEach((track) => track.stop());
        starting.current = false;
        return;
      }
      stream.current = acquired;
    } catch {
      starting.current = false;
      if (!mounted.current) return;
      setState("ready");
      setError("Allow microphone access in browser settings, then retry.");
      return;
    }
    const type = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find(
      (t) => MediaRecorder.isTypeSupported?.(t),
    );
    // Speech needs little: 32 kbit/s keeps an hour's lecture near 15 MB.
    try {
      const rec = new MediaRecorder(stream.current, {
        ...(type ? { mimeType: type } : {}),
        audioBitsPerSecond: 32_000,
      });
      parts.current = [];
      rec.ondataavailable = (e) => e.data.size && parts.current.push(e.data);
      rec.onstop = () => {
        stopTracks();
        if (!mounted.current) return;
        const mime = (rec.mimeType || type || "audio/webm").split(";")[0];
        const blob = new Blob(parts.current, { type: mime });
        if (!blob.size) {
          setState("ready");
          setError("Nothing was recorded. Try again.");
          return;
        }
        const at = new Date();
        const name = `Recording ${at.toLocaleDateString([], {
          day: "numeric",
          month: "short",
        })} ${at.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })}.${mime.includes("mp4") ? "m4a" : "weba"}`.replace(/[/:]/g, ".");
        setState("saving");
        doneRef.current(new File([blob], name, { type: mime }));
      };
      recorder.current = rec;
      rec.start(1000);
      started.current = Date.now();
      setSeconds(0);
      setState("on");
    } catch (error) {
      stopTracks();
      if (mounted.current) {
        setState("ready");
        setError(errorText(error));
      }
    } finally {
      starting.current = false;
    }
  };
  const stop = () => {
    if (recorder.current?.state === "recording") recorder.current.stop();
  };

  return createPortal(
    <dialog
      ref={focus.ref as React.RefObject<HTMLDialogElement>}
      data-modal-focus={focus.id}
      className="modal recorder"
      aria-labelledby="recorder-title"
      onCancel={(event) => {
        event.preventDefault();
        if (state === "ready") onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && state === "ready")
          onClose();
      }}
    >
      <div className="section-heading">
        <h2 id="recorder-title">Record audio</h2>
        <button
          className="icon-button"
          aria-label="Close"
          disabled={state !== "ready"}
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      <p className="recorder-note">{RECORDING_CONSENT}</p>
      <div className="recorder-clock" aria-live="polite">
        <span className={"recorder-dot" + (state === "on" ? " is-on" : "")} />
        {recordingClock(seconds)}
        <small>of {RECORDING_MAX_MINUTES} min</small>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="recorder-actions">
        {state === "on" ? (
          <button className="primary" onClick={stop}>
            <Square size={15} /> Stop and add to page
          </button>
        ) : (
          <button
            className="primary"
            disabled={state !== "ready"}
            onClick={() => void start()}
          >
            {state === "ready" ? (
              <>
                <Mic size={15} /> Record
              </>
            ) : (
              <>
                <Loader2 size={15} className="spin" />{" "}
                {state === "asking" ? "Waiting for the microphone…" : "Adding…"}
              </>
            )}
          </button>
        )}
      </div>
    </dialog>,
    document.body,
  );
}

/**
 * A recording's summary and action items (CAP-10), asked of the hosted
 * assistant only when the person presses Summarise. Nothing changes until
 * they add the summary to the page or make the action items tasks.
 */
export function RecordingSummaryDialog({
  fileId,
  name,
  onAddToPage,
  onClose,
}: {
  fileId: string;
  name: string;
  /** Put the summary lines under the recording. */
  onAddToPage?: (lines: DocBlock[]) => void;
  onClose: () => void;
}) {
  return (
    <RecordingSummaryBody
      key={fileId}
      fileId={fileId}
      name={name}
      onAddToPage={onAddToPage}
      onClose={onClose}
    />
  );
}

function RecordingSummaryBody({
  fileId,
  name,
  onAddToPage,
  onClose,
}: {
  fileId: string;
  name: string;
  onAddToPage?: (lines: DocBlock[]) => void;
  onClose: () => void;
}) {
  const [asked, setAsked] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [result, setResult] = useState<RecordingSummary | null>(null);
  const [error, setError] = useState("");
  const [made, setMade] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const summaryGeneration = useRef(0);
  const mutation = useRef(false);
  const focus = useModalFocus(onClose, busy || (asked && !result));
  useEffect(() => {
    const dialog = focus.ref.current as HTMLDialogElement | null;
    dialog?.showModal();
    return () => {
      dialog?.close();
    };
  }, []);
  useEffect(() => {
    summaryGeneration.current++;
    setAsked(false);
    setTranscript("");
    setResult(null);
    setError("");
    setMade(new Set());
    setBusy(false);
    return () => {
      summaryGeneration.current++;
    };
  }, [fileId]);
  const ask = () => {
    if (mutation.current || asked) return;
    mutation.current = true;
    const generation = summaryGeneration.current;
    setAsked(true);
    setError("");
    client.summariseRecording(fileId, transcript.trim() || undefined).then(
      (value) => {
        if (generation === summaryGeneration.current) {
          mutation.current = false;
          setResult(value);
        }
      },
      (e) => {
        if (generation !== summaryGeneration.current) return;
        mutation.current = false;
        setError(errorText(e));
        setAsked(false);
      },
    );
  };
  const makeTask = async (i: number) => {
    if (!result || mutation.current || made.has(i) || !result.actions[i])
      return;
    mutation.current = true;
    const generation = summaryGeneration.current;
    const a = result.actions[i];
    setBusy(true);
    try {
      await client.createItem({
        title: a.title,
        kind: "task",
        ...(a.due
          ? { due_at: new Date(`${a.due}T17:00:00`).toISOString() }
          : {}),
      });
      if (generation === summaryGeneration.current)
        setMade((s) => new Set(s).add(i));
    } catch (e) {
      if (generation === summaryGeneration.current) setError(errorText(e));
    } finally {
      if (generation === summaryGeneration.current) {
        mutation.current = false;
        setBusy(false);
      }
    }
  };
  return createPortal(
    <dialog
      ref={focus.ref as React.RefObject<HTMLDialogElement>}
      data-modal-focus={focus.id}
      className="modal recorder"
      aria-labelledby="summary-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!mutation.current) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !mutation.current)
          onClose();
      }}
    >
      <div className="section-heading">
        <h2 id="summary-title">Recording summary</h2>
        <button
          className="icon-button"
          aria-label="Close"
          disabled={busy || (asked && !result)}
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      <p className="recorder-file" dir="auto">
        {name}
      </p>
      {!result ? (
        <>
          <p className="recorder-note">
            Summaries use your selected AI. ChatGPT accepts transcripts; audio
            transcription needs Orbyn's provider.
          </p>
          <label className="recorder-transcript">
            Transcript (optional)
            <textarea
              value={transcript}
              onChange={(event) => setTranscript(event.target.value)}
              maxLength={200000}
              disabled={asked}
              rows={4}
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="recorder-actions">
            <button className="primary" disabled={asked} onClick={ask}>
              {asked ? (
                <>
                  <Loader2 size={15} className="spin" /> Preparing summary…
                </>
              ) : (
                <>
                  <Sparkles size={15} /> Summarise
                </>
              )}
            </button>
          </div>
        </>
      ) : (
        <>
          {result.provider && (
            <p className="recorder-note">
              {aiFeatureProviderLabel(result.provider)}
            </p>
          )}
          <div className="recorder-summary" dir="auto">
            {result.summary.split(/\n{2,}/).map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
          {result.actions.length > 0 && (
            <>
              <h3 className="recorder-subhead">Action items</h3>
              <ul className="recorder-actions-list">
                {result.actions.map((a, i) => (
                  <li key={i}>
                    <span dir="auto">
                      {a.title}
                      {a.due && <small> · by {a.due}</small>}
                    </span>
                    <button
                      className="text-button"
                      disabled={busy || made.has(i)}
                      onClick={() => void makeTask(i)}
                    >
                      {made.has(i) ? "Added" : "Make a task"}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="recorder-actions">
            {onAddToPage && (
              <button
                className="primary"
                disabled={busy}
                onClick={() => {
                  if (mutation.current) return;
                  onAddToPage(summaryLines(result));
                  onClose();
                }}
              >
                Add to page
              </button>
            )}
          </div>
        </>
      )}
    </dialog>,
    document.body,
  );
}
