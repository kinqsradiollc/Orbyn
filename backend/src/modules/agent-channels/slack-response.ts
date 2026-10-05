/** Bounded provider JSON; private response bodies never become error messages. */
export async function slackJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error("Unavailable");
  const reader = response.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 65536) throw new Error("Unavailable");
      chunks.push(part.value);
    }
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
    );
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
/** Slack's declared non-acceptance delay, bounded for recovery scheduling. */
export function slackRetryAfter(response: Response) {
  const value = response.headers.get("retry-after");
  return value && /^\d{1,6}$/.test(value)
    ? Math.max(5, Math.min(3600, Number(value)))
    : 60;
}
