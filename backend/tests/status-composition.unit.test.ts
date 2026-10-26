import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { buildSync, transformSync } from "esbuild";
import ts from "typescript";
import * as requireZod from "zod";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path: string) =>
  readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
function graph(entry: string) {
  const result = buildSync({
    absWorkingDir: root,
    entryPoints: [`backend/src/${entry}`],
    bundle: true,
    packages: "external",
    platform: "node",
    format: "esm",
    target: "node22",
    write: false,
    metafile: true,
    logLevel: "silent",
  });
  return Object.keys(result.metafile!.inputs);
}

test("actual status entrypoint and status route graph exclude unrelated backend routes and provider implementations", () => {
  for (const entry of ["services/status.ts", "modules/status/routes.ts"]) {
    const inputs = graph(entry);
    assert.ok(inputs.includes("backend/src/modules/status/routes.ts"));
    assert.ok(inputs.includes("backend/src/modules/status/report.ts"));
    assert.ok(inputs.includes("backend/src/modules/status/components.ts"));
    assert.ok(inputs.includes("backend/src/config/env.ts"));
    assert.ok(!inputs.includes("backend/src/app.ts"));
    assert.deepEqual(
      inputs.filter(
        (path) =>
          path.startsWith("backend/src/modules/") &&
          !path.startsWith("backend/src/modules/status/"),
      ),
      [],
    );
    assert.deepEqual(
      inputs.filter((path) => /backend\/src\/providers\//.test(path)),
      [],
    );
  }
  assert.ok(
    graph("services/status.ts").includes("backend/src/services/http.ts"),
  );
});

test("status factory uses the original shared HTTP shell and exactly its owned route plugin", async () => {
  const calls: unknown[] = [];
  const routes = () => {};
  const app = {};
  const module = { exports: {} as { buildStatusService(): Promise<unknown> } };
  runInNewContext(
    transformSync(source("services/status-app.ts"), {
      loader: "ts",
      format: "cjs",
      target: "es2022",
    }).code,
    {
      module,
      exports: module.exports,
      require(name: string) {
        if (name === "./http.js")
          return {
            createService: async (...args: unknown[]) => {
              calls.push(args);
              return app;
            },
          };
        if (name === "../modules/status/routes.js")
          return { statusRoutes: routes };
        throw new Error(`Unexpected status composition dependency ${name}`);
      },
    },
  );
  assert.equal(await module.exports.buildStatusService(), app);
  assert.equal((calls[0] as unknown[])[0], "status");
  assert.deepEqual(Array.from((calls[0] as unknown[])[1] as unknown[]), [
    routes,
  ]);
});

test("real environment validation remains in the status graph with provider credentials optional", () => {
  const envSource = source("config/env.ts").replaceAll(
    "import.meta.url",
    JSON.stringify(new URL("../src/config/env.ts", import.meta.url).href),
  );
  const code = transformSync(envSource, {
    loader: "ts",
    format: "cjs",
    target: "es2022",
  }).code;
  const load = (input: Record<string, string>) => {
    const module = { exports: {} as { env: Record<string, unknown> } };
    runInNewContext(code, {
      module,
      exports: module.exports,
      process: { env: input },
      require(name: string) {
        if (name === "dotenv") return { config() {} };
        if (name === "node:url") return { fileURLToPath: () => "fixture.env" };
        if (name === "zod") return requireZod;
        throw new Error(`Unexpected environment dependency ${name}`);
      },
      URL,
    });
    return module.exports.env;
  };
  const minimal = load({ PORT: "8123" });
  assert.equal(minimal.PORT, 8123);
  assert.equal(minimal.STATUS_INTERVAL_MS, 30000);
  assert.equal(minimal.SECRETS_KEY, "");
  assert.equal(minimal.SMTP_PASSWORD, "");
  assert.throws(() => load({ PORT: "not-a-number" }), /PORT/);
  assert.throws(() => load({ STATUS_INTERVAL_MS: "1" }), /STATUS_INTERVAL_MS/);
  // This first extraction retains the existing full environment contract;
  // unrelated invalid settings are not silently exempted by a new shell.
  assert.throws(
    () => load({ DOC_PDF_CONCURRENCY: "invalid" }),
    /DOC_PDF_CONCURRENCY/,
  );
});

function startServiceCallback(context: Record<string, unknown>) {
  const tree = ts.createSourceFile(
    "http.ts",
    source("services/http.ts"),
    ts.ScriptTarget.Latest,
    true,
  );
  const fn = tree.statements.find(
    (node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) && node.name?.text === "startService",
  );
  assert.ok(fn);
  const declaration = fn.getText(tree).replace(/^export /, "");
  return runInNewContext(
    transformSync(`${declaration}; startService;`, {
      loader: "ts",
      target: "es2022",
    }).code,
    context,
  );
}

test("actual status entrypoint passes its stop callback and configured port to shared startup", async () => {
  const order: string[] = [];
  const app = {};
  const stop = () => order.push("stopProber");
  const module = { exports: {} };
  const compiled = ts.transpileModule(source("services/status.ts"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText;
  await runInNewContext(`(async () => { ${compiled} })()`, {
    module,
    exports: module.exports,
    require(name: string) {
      if (name === "./status-app.js")
        return {
          buildStatusService: async () => {
            order.push("build");
            return app;
          },
        };
      if (name === "../config/env.js") return { env: { PORT: 8123 } };
      if (name === "../modules/status/prober.js")
        return {
          startProber: () => {
            order.push("prober");
            return stop;
          },
        };
      if (name === "./http.js")
        return {
          startService: async (
            value: unknown,
            port: number,
            onStop: unknown,
          ) => {
            assert.equal(value, app);
            assert.equal(port, 8123);
            assert.equal(onStop, stop);
            order.push("start");
          },
        };
      throw new Error(`Unexpected entrypoint dependency ${name}`);
    },
  });
  assert.deepEqual(order, ["prober", "build", "start"]);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  test(`shared ${signal} lifecycle stops probes before app and database shutdown`, async () => {
    const order: string[] = [];
    const handlers = new Map<string, () => Promise<void>>();
    const start = startServiceCallback({
      closeDatabase: async () => {
        order.push("database");
      },
      process: {
        on: (name: string, callback: () => Promise<void>) =>
          handlers.set(name, callback),
        exit: (code: number) => {
          assert.equal(code, 0);
          order.push("exit");
        },
      },
    });
    await start(
      {
        listen: async (options: { host: string; port: number }) => {
          assert.equal(options.host, "0.0.0.0");
          assert.equal(options.port, 8123);
          order.push("listen");
        },
        close: async () => {
          order.push("app");
        },
      },
      8123,
      () => {
        order.push("prober");
      },
    );
    await handlers.get(signal)!();
    assert.deepEqual(order, ["listen", "prober", "app", "database", "exit"]);
  });
}
