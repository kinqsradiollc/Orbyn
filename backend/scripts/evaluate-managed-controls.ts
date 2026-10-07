import { writeFile } from "node:fs/promises";
import { evaluateManagedControls } from "../src/modules/ai/providers/evaluation.js";
import { aiModelCapabilities } from "@orbyn/core";
// Deliberate standalone invocation; no workspace credentials or personal content are loaded here.
const model = process.env.EVALUATION_MODEL ?? "";
const key = process.env.EVALUATION_OPENAI_API_KEY ?? "";
const output = process.env.EVALUATION_OUTPUT ?? "";
if (!key || !output || !aiModelCapabilities("openai", model).cacheModes.length)
  throw new Error(
    "Set EVALUATION_MODEL, EVALUATION_OPENAI_API_KEY and EVALUATION_OUTPUT. This runs six paid managed-provider requests using fixed non-personal text.",
  );
const report = await evaluateManagedControls({
  kind: "openai",
  format: "openai",
  requestFormat: "responses",
  baseUrl: "https://api.openai.com/v1",
  apiKey: key,
  model,
  source: "database",
  providerId: "standalone-evaluation",
  options: { reasoningEffort: "low" },
});
await writeFile(output, JSON.stringify(report, null, 2) + "\n", {
  mode: 0o600,
});
