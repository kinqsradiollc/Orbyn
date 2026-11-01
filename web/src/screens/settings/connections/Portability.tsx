import {
  csvFormat,
  HttpError,
  type ImportSummary,
  type PagesImportSummary,
  type TaskImportFormat,
} from "@orbyn/core";
import { useRef, useState } from "react";
import { client } from "../../../lib/session";
import { messageOf } from "../../../lib/resource";
import {
  Button,
  ErrorNotice,
  Field,
  Input,
  SelectBox,
  TextArea,
} from "../../../ui/kit";
import { SettingsSection, useSettingsExit, useSettingsOwner } from "../shared";
import { download } from "./common";
import { goTo } from "../../library/store";
import { navigate } from "../../../lib/router";

type Payload =
  | { kind: "tasks"; format: TaskImportFormat; data: string }
  | {
      kind: "pages";
      format: "markdown" | "notion";
      file_name: string;
      data: string;
    };
type Receipt = ImportSummary | PagesImportSummary;
type Attempt = { payload: Payload; key: string; started: number };
export function Portability() {
  const owned = useSettingsOwner(),
    lock = useRef(false),
    attempt = useRef<Attempt | null>(null),
    readEpoch = useRef(0);
  const [kind, setKind] = useState<"tasks" | "pages">("tasks"),
    [format, setFormat] = useState<TaskImportFormat>("csv"),
    [pageFormat, setPageFormat] = useState<"markdown" | "notion">("markdown"),
    [file, setFile] = useState(""),
    [data, setData] = useState(""),
    [preview, setPreview] = useState<{
      payload: Payload;
      receipt: Receipt;
    } | null>(null),
    [receipt, setReceipt] = useState<Receipt | null>(null),
    [busy, setBusy] = useState(false),
    [unknown, setUnknown] = useState(false),
    [error, setError] = useState("");
  useSettingsExit({
    dirty: !!data,
    pending: busy || unknown,
    message: unknown
      ? "Retry the exact import attempt or check imported content before leaving."
      : "Finish or discard the import draft.",
  });
  const payload = (): Payload =>
    kind === "tasks"
      ? { kind, format, data }
      : { kind, format: pageFormat, file_name: file, data };
  const clearPreview = () => {
    readEpoch.current++;
    setPreview(null);
    setReceipt(null);
    setError("");
  };
  async function readFile(value: File) {
    if (lock.current || unknown || !owned()) return;
    lock.current = true;
    setBusy(true);
    clearPreview();
    try {
      if (value.size > (kind === "pages" ? 20 * 1024 * 1024 : 5_000_000))
        throw Error(
          "This file exceeds the import limit. Split it before importing.",
        );
      const next =
        kind === "pages"
          ? await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () =>
                resolve(
                  String(reader.result ?? "").replace(/^data:[^,]*,/, ""),
                );
              reader.onerror = () => reject(Error("Could not read the file."));
              reader.readAsDataURL(value);
            })
          : await value.text();
      if (owned()) {
        setFile(value.name);
        setData(next);
        if (kind === "tasks")
          setFormat(
            value.name.toLowerCase().endsWith(".csv")
              ? csvFormat(next)
              : "orbyn",
          );
      }
    } catch (failure) {
      if (owned()) setError(messageOf(failure, "Could not read the file."));
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  }
  async function inspect() {
    if (lock.current || unknown || !owned() || !data) return;
    lock.current = true;
    setBusy(true);
    setError("");
    const target = payload(),
      epoch = ++readEpoch.current;
    try {
      const result =
        target.kind === "tasks"
          ? await client.importData({
              format: target.format,
              data: target.data,
              dry_run: true,
            })
          : await client.importPages({
              format: target.format,
              file_name: target.file_name,
              data: target.data,
              dry_run: true,
            });
      if (owned() && epoch === readEpoch.current)
        setPreview({ payload: target, receipt: result });
    } catch (failure) {
      if (owned())
        setError(messageOf(failure, "Could not preview the import."));
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  }
  async function apply() {
    if (lock.current || !owned()) return;
    const prior = attempt.current;
    const target = unknown ? prior?.payload : preview?.payload;
    if (
      !target ||
      (!unknown && JSON.stringify(target) !== JSON.stringify(payload()))
    )
      return;
    if (
      prior &&
      unknown &&
      (Date.now() - prior.started < 0 ||
        Date.now() - prior.started >= 23 * 60 * 60 * 1000)
    ) {
      setError(
        "This attempt expired. Inspect imported content before starting another import. It will not be replayed.",
      );
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    const active =
      prior && unknown
        ? prior
        : {
            payload: structuredClone(target),
            key: crypto.randomUUID(),
            started: Date.now(),
          };
    attempt.current = active;
    try {
      const result = await client.once<Receipt>(active.key, () =>
        active.payload.kind === "tasks"
          ? client.importData({
              format: active.payload.format,
              data: active.payload.data,
              dry_run: false,
            })
          : client.importPages({
              format: active.payload.format,
              file_name: active.payload.file_name,
              data: active.payload.data,
              dry_run: false,
            }),
      );
      if (owned()) {
        setUnknown(false);
        setReceipt(result);
        setPreview(null);
        if (!result.errors.length) {
          setData("");
          setFile("");
          setPreview(null);
          attempt.current = null;
        }
      }
    } catch (failure) {
      if (owned()) {
        setUnknown(
          !(failure instanceof HttpError) ||
            failure.statusCode >= 500 ||
            [408, 425, 429].includes(failure.statusCode),
        );
        setError(
          messageOf(
            failure,
            "Import receipt unavailable. Retry uses the same payload and request identity.",
          ),
        );
      }
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  }
  async function exportFile(all: boolean) {
    if (lock.current || unknown || !owned()) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      if (all) {
        const value = await client.exportArchive();
        if (owned()) download(value.blob, value.name);
      } else {
        const value = await client.exportData();
        if (owned())
          download(
            new Blob([JSON.stringify(value, null, 2)], {
              type: "application/json",
            }),
            `orbyn-export-${new Date().toISOString().slice(0, 10)}.json`,
          );
      }
    } catch (failure) {
      if (owned())
        setError(messageOf(failure, "Could not download the export."));
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  }
  return (
    <SettingsSection
      title="Import & export"
      description="Preview imported content before adding it. Exports download to this device."
    >
      <div className="settings-actions">
        <Button
          disabled={busy || unknown}
          onClick={() => void exportFile(false)}
        >
          Export planner JSON
        </Button>
        <Button
          disabled={busy || unknown}
          onClick={() => void exportFile(true)}
        >
          Export everything ZIP
        </Button>
      </div>
      <fieldset disabled={busy || unknown} className="settings-form">
        <Field label="Import">
          <SelectBox
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as "tasks" | "pages");
              setData("");
              setFile("");
              clearPreview();
            }}
          >
            <option value="tasks">Tasks and planner</option>
            <option value="pages">Pages and folders</option>
          </SelectBox>
        </Field>
        {kind === "tasks" ? (
          <Field label="Task format">
            <SelectBox
              value={format}
              onChange={(e) => {
                setFormat(e.target.value as TaskImportFormat);
                clearPreview();
              }}
            >
              {(["csv", "orbyn", "todoist", "ticktick"] as const).map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </SelectBox>
          </Field>
        ) : (
          <Field label="Page format">
            <SelectBox
              value={pageFormat}
              onChange={(e) => {
                setPageFormat(e.target.value as "markdown" | "notion");
                clearPreview();
              }}
            >
              <option value="markdown">Markdown (.md or .zip)</option>
              <option value="notion">Notion export (.zip)</option>
            </SelectBox>
          </Field>
        )}
        <Field label="Import file">
          <Input
            type="file"
            accept={kind === "tasks" ? ".json,.csv" : ".zip,.md,.markdown,.txt"}
            onChange={(e) => {
              const chosen = e.target.files?.[0];
              if (chosen) void readFile(chosen);
              e.target.value = "";
            }}
          />
        </Field>
        {file && <p dir="auto">{file}</p>}
        {kind === "tasks" && (
          <Field label="Or paste data">
            <TextArea
              value={data}
              maxLength={5_000_000}
              onChange={(e) => {
                setData(e.target.value);
                clearPreview();
              }}
            />
          </Field>
        )}
        <Button disabled={!data} onClick={() => void inspect()}>
          Preview import
        </Button>
      </fieldset>
      {preview && <Summary receipt={preview.receipt} />}
      {preview && !preview.receipt.errors.length && !unknown && (
        <Button disabled={busy} onClick={() => void apply()}>
          Import this preview
        </Button>
      )}
      {unknown && (
        <Button disabled={busy} onClick={() => void apply()}>
          Retry exact import attempt
        </Button>
      )}
      {receipt && (
        <>
          <h4>Import receipt</h4>
          <Summary receipt={receipt} />
          {"folder_id" in receipt && receipt.folder_id && (
            <a
              href="/app/docs"
              onClick={(event) => {
                event.preventDefault();
                if (!owned() || !("folder_id" in receipt) || !receipt.folder_id)
                  return;
                goTo({ at: "folder", id: receipt.folder_id });
                navigate("/app/docs");
              }}
            >
              Open imported folder
            </a>
          )}
        </>
      )}
      {error && <ErrorNotice message={error} />}
    </SettingsSection>
  );
}
function Summary({ receipt }: { receipt: Receipt }) {
  return (
    <div className="settings-connections-import-summary">
      <p>
        {"pages" in receipt
          ? `${receipt.pages} pages · ${receipt.folders} folders · ${receipt.projects} projects · ${receipt.tasks} tasks · ${receipt.links} links`
          : `${receipt.created} tasks · ${receipt.skipped} skipped · ${receipt.lists_added} lists · ${receipt.tags_added} tags`}
      </p>
      {receipt.sample.map((text, i) => (
        <p key={i} dir="auto">
          {text}
        </p>
      ))}
      {"left_out" in receipt &&
        receipt.left_out.map((text, i) => (
          <p className="small" key={i} dir="auto">
            Left out: {text}
          </p>
        ))}
      {receipt.errors.map((text, i) => (
        <p role="alert" key={i} dir="auto">
          {text}
        </p>
      ))}
    </div>
  );
}
