import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

// Run each real platform dispatcher with only its singleton transport replaced.
// The test observes the ordering seen by a synchronous refresh listener.
for (const platform of ["desktop", "mobile"]) {
  test(`${platform} live changes fence cached reads before notifying refresh listeners`, async () => {
    const path = new URL(`../../${platform}/src/lib/live.ts`, import.meta.url)
      .pathname;
    const result = await build({
      stdin: {
        contents: `export * from ${JSON.stringify(path)}; export { client } from "fixture-api";`,
        resolveDir: process.cwd(),
      },
      bundle: true,
      write: false,
      platform: "node",
      format: "esm",
      plugins: [
        {
          name: "fixture-api",
          setup(builder) {
            builder.onResolve({ filter: /^(\.\/api|fixture-api)$/ }, () => ({
              path: "fixture-api",
              namespace: "fixture",
            }));
            builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
              contents: `export const client = { epoch: 0, noteExternalMutation() { this.epoch++; } };`,
            }));
          },
        },
      ],
    });
    const live = await import(
      `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
    );
    const observed: number[] = [];
    const stop = live.onLive(() => observed.push(live.client.epoch));
    live.emitLive({ kind: "presence" });
    live.emitLive({ kind: "changed", area: "records" });
    // Reconnection has no area: missed changes still require a fresh read.
    live.emitLive({ kind: "changed" });
    assert.deepEqual(observed, [0, 1, 2]);
    stop();
    live.emitLive({ kind: "changed", area: "docs" });
    assert.equal(live.client.epoch, 3);
    assert.deepEqual(
      observed,
      [0, 1, 2],
      "unsubscribed listeners stay stopped",
    );
  });
}
