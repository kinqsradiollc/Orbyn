import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { buildSync, transformSync } from "esbuild";
import ts from "typescript";

// Ordered registration baseline captured before composition extraction.
const expected = {
  api: [
    "agentChannelRoutes",
    "teamsChannelRoutes",
    "createTeamsActivityRoutes()",
    "createSlackReplyRoutes()",
    "chatgptModelRoutes",
    "systemRoutes",
    "authRoutes",
    "userRoutes",
    "legalRoutes",
    "studyRoutes",
    "importRoutes",
    "originalRoutes",
    "inboundRoutes",
    "agentRoutes",
    "agentInboxRoutes",
    "agentContextRoutes",
    "assistantIdeasRoutes",
    "assistantGoalRoutes",
    "assistantRoutineRoutes",
    "overnightRoutes",
    "assistantActivityRoutes",
    "assistantConversationRoutes",
    "assistantProfileRoutes",
    "assistantBudgetRoutes",
    "assistantHandoffRoutes",
    "assistantRulesRoutes",
    "reminderActionRoutes",
    "memoryRoutes",
    "proposalRoutes",
    "oauthRoutes",
    "appLinkRoutes",
    "davRoutes",
    "itemRoutes",
    "deviceRoutes",
    "notificationRoutes",
    "teamRoutes",
    "adminRoutes",
    "publishingRoutes",
    "organizeRoutes",
    "docRoutes",
    "docContentRoutes",
    "mentionRoutes",
    "docStructureRoutes",
    "docInfoRoutes",
    "viewRoutes",
    "captureRoutes",
    "searchRoutes",
    "linkRoutes",
    "pageFileRoutes",
    "aiDocRoutes",
    "folderRoutes",
    "developerRoutes",
    "projectRoutes",
    "workRecordRoutes",
    "plannerRoutes",
    "teamPlanningRoutes",
    "accessRoutes",
    "bookingRoutes",
    "inviteRoutes",
    "profileRoutes",
    "rsvpRoutes",
    "subscriptionRoutes",
    "focusRoutes",
    "presenceRoutes",
    "teamCapacityRoutes",
    "templateRoutes",
    "pageTemplateRoutes",
    "followThroughRoutes",
    "teamChangeRoutes",
    "firstRunRoutes",
    "publishRoutes",
    "scopedPublicationRoutes",
    "pageImportRoutes",
    "prefRoutes",
    "homeRoutes",
    "libraryRoutes",
    "teamPolicyRoutes",
    "clipRoutes",
    "legacyDocStreamRoutes",
  ],
  ai: [
    "chatgptConnectionRoutes",
    "chatgptExecutorRoutes",
    "aiRoutes",
    "aiAdminRoutes",
    "aiStudyRoutes",
    "projectChatRoutes",
    "aiCaptureRoutes",
    "aiRecordingRoutes",
  ],
  status: ["statusRoutes"],
  realtime: ["realtimeRoutes", "legacyDocStreamRoutes", "mcpListenRoutes"],
  files: ["filesRoutes", "pageFileStoreRoutes"],
  mcp: ["mcpServerRoutes"],
  plugin: ["pluginDiscoveryRoutes", "pluginRoutes", "mcpIntegrationRoutes"],
} as const;

const root = fileURLToPath(new URL("../../", import.meta.url));
const names = {
  api: "Api",
  ai: "Ai",
  status: "Status",
  realtime: "Realtime",
  files: "Files",
  mcp: "Mcp",
  plugin: "Plugin",
};
const read = (path: string) =>
  readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
for (const name of Object.keys(expected) as Array<keyof typeof expected>) {
  test(`${name} composes the original ordered routes through the unchanged HTTP shell`, async () => {
    const text = read(`services/${name}-app.ts`);
    const tree = ts.createSourceFile(
      `${name}-app.ts`,
      text,
      ts.ScriptTarget.Latest,
      true,
    );
    const modules = tree.statements.flatMap((node) =>
      ts.isVariableStatement(node)
        ? node.declarationList.declarations.filter(
            (entry) => entry.name.getText(tree) === `${name}Modules`,
          )
        : [],
    );
    assert.equal(modules.length, 1);
    const array = modules[0].initializer;
    assert.ok(array && ts.isArrayLiteralExpression(array));
    assert.deepEqual(
      array.elements.map((entry) => entry.getText(tree)),
      [...expected[name]],
    );
    const imports: Record<string, Record<string, unknown>> = {};
    for (const node of tree.statements) {
      if (!ts.isImportDeclaration(node)) continue;
      const from = (node.moduleSpecifier as ts.StringLiteral).text;
      const bindings = node.importClause?.namedBindings;
      if (!bindings || !ts.isNamedImports(bindings)) continue;
      imports[from] ??= {};
      for (const item of bindings.elements) {
        const routeName = item.name.text;
        const route = Object.assign(() => {}, { routeName });
        imports[from][routeName] = (
          expected[name] as readonly string[]
        ).includes(`${routeName}()`)
          ? () => Object.assign(() => {}, { routeName: `${routeName}()` })
          : route;
      }
    }
    let called = false;
    const app = {};
    imports[name === "status" ? "./http-shared.js" : "./http.js"] = {
      createService: async (
        service: string,
        routes: Array<{ routeName: string }>,
      ) => {
        assert.equal(service, name);
        assert.deepEqual(
          Array.from(routes, (route) => route.routeName),
          [...expected[name]],
        );
        called = true;
        return app;
      },
    };
    const module = { exports: {} as Record<string, () => Promise<unknown>> };
    runInNewContext(
      transformSync(text, { loader: "ts", format: "cjs", target: "es2022" })
        .code,
      {
        module,
        exports: module.exports,
        require: (path: string) => {
          assert.ok(imports[path], `Unexpected root dependency ${path}`);
          return imports[path];
        },
      },
    );
    assert.equal(await module.exports[`build${names[name]}Service`](), app);
    assert.equal(called, true);
  });

  test(`${name} deployed entrypoint never imports the combined app and includes its owned root`, () => {
    const result = buildSync({
      absWorkingDir: root,
      entryPoints: [`backend/src/services/${name}.ts`],
      bundle: true,
      packages: "external",
      platform: "node",
      format: "esm",
      target: "node22",
      write: false,
      metafile: true,
      logLevel: "silent",
    });
    const inputs = Object.keys(result.metafile!.inputs);
    assert.ok(inputs.includes(`backend/src/services/${name}-app.ts`));
    assert.ok(inputs.includes("backend/src/services/http-shared.ts"));
    assert.equal(
      inputs.includes("backend/src/services/http.ts"),
      name !== "status",
    );
    assert.equal(
      inputs.includes("backend/src/lib/idempotency.ts"),
      name !== "status",
    );
    assert.ok(inputs.includes("backend/src/config/env.ts"));
    assert.ok(!inputs.includes("backend/src/app.ts"));
    assert.deepEqual(
      inputs.filter((path) =>
        /backend\/src\/services\/[a-z]+-app\.ts$/.test(path),
      ),
      [`backend/src/services/${name}-app.ts`],
      "Only the owning composition root is imported; transitive domain helpers remain allowed",
    );
  });
}

test("combined development composition retains first plugins, shared legacy routes and its explicit union", () => {
  const tree = ts.createSourceFile(
    "app.ts",
    read("app.ts"),
    ts.ScriptTarget.Latest,
    true,
  );
  let body: ts.ArrayLiteralExpression | undefined;
  const find = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(tree) === "createService" &&
      node.arguments[0]?.getText(tree) === '"all"' &&
      ts.isArrayLiteralExpression(node.arguments[1])
    )
      body = node.arguments[1];
    ts.forEachChild(node, find);
  };
  find(tree);
  assert.ok(body);
  assert.deepEqual(
    body.elements.map((entry) => entry.getText(tree)),
    [
      "...first",
      "...serviceModules.api",
      "...serviceModules.ai",
      "...serviceModules.status",
      "...serviceModules.files",
      "...serviceModules.mcp",
      "realtimeRoutes",
    ],
  );
  assert.ok(expected.api.includes("legacyDocStreamRoutes"));
  assert.ok(expected.realtime.includes("legacyDocStreamRoutes"));
});

for (const name of [
  "api",
  "ai",
  "realtime",
  "files",
  "mcp",
  "plugin",
] as const) {
  test(`${name} actual entrypoint retains configured startup and owned worker shutdown wiring`, async () => {
    const order: string[] = [];
    const app = {
      log: { error() {} },
      addHook: (hook: string, callback: () => Promise<void>) => {
        assert.equal(hook, "onClose");
        close = callback;
        order.push("close-hook");
      },
    };
    let close: (() => Promise<void>) | undefined;
    const stop = () => {
      order.push("worker-stop");
    };
    const module = { exports: {} };
    const code = ts.transpileModule(read(`services/${name}.ts`), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
      },
    }).outputText;
    await runInNewContext(`(async () => { ${code} })()`, {
      module,
      exports: module.exports,
      require(path: string) {
        if (path === `./${name}-app.js`)
          return {
            [`build${names[name]}Service`]: async () => {
              order.push("build");
              return app;
            },
          };
        if (path === "../config/env.js")
          return {
            env: {
              PORT: 8123,
              MCP_PUBLIC_URL: "https://mcp.example.invalid",
              PLUGIN_PUBLIC_URL: "https://plugin.example.invalid",
            },
          };
        if (path === "../modules/plugin/inference-worker.js")
          return {
            startPluginAiWorker: (
              origins: { mcp: string; plugin: string },
              onError: () => void,
            ) => {
              assert.equal(origins.mcp, "https://mcp.example.invalid");
              assert.equal(origins.plugin, "https://plugin.example.invalid");
              assert.equal(typeof onError, "function");
              order.push("worker-start");
              return stop;
            },
          };
        if (path === "./http.js")
          return {
            startService: async (
              value: unknown,
              port: number,
              onStop?: unknown,
            ) => {
              assert.equal(value, app);
              assert.equal(port, 8123);
              assert.equal(onStop, name === "plugin" ? stop : undefined);
              order.push("listen");
            },
          };
        throw new Error(`Unexpected ${name} entrypoint dependency ${path}`);
      },
    });
    if (name === "plugin") {
      assert.deepEqual(order, [
        "build",
        "worker-start",
        "close-hook",
        "listen",
      ]);
      assert.ok(close);
      await close();
      assert.equal(order.at(-1), "worker-stop");
    } else assert.deepEqual(order, ["build", "listen"]);
  });
}

test("application HTTP compatibility wrapper supplies the canonical installer for every non-status service", async () => {
  const installer = () => {};
  const calls: unknown[][] = [];
  const shared = {
    createService: async (...args: unknown[]) => {
      calls.push(args);
      return "fixture-app";
    },
  };
  const module = {
    exports: {} as { createService: (...args: unknown[]) => Promise<unknown> },
  };
  runInNewContext(
    transformSync(read("services/http.ts"), {
      loader: "ts",
      format: "cjs",
      target: "es2022",
    }).code,
    {
      module,
      exports: module.exports,
      require(path: string) {
        if (path === "./http-shared.js") return shared;
        if (path === "../lib/idempotency.js") return { idempotency: installer };
        throw new Error(`Unexpected HTTP compatibility dependency ${path}`);
      },
    },
  );
  for (const name of [
    "api",
    "ai",
    "assistant-background",
    "assistant-overnight",
    "files",
    "realtime",
    "mcp",
    "plugin",
    "all",
    "status",
  ]) {
    const modules = [() => {}];
    assert.equal(
      await module.exports.createService(name, modules),
      "fixture-app",
    );
    const args = calls.at(-1)!;
    assert.equal(args[0], name);
    assert.equal(args[1], modules);
    assert.equal(args[2], name === "status" ? undefined : installer);
  }
});

test("shared HTTP shell fails closed without application guards and installs them before owned routes", async (t) => {
  const { createService } = await import("../src/services/http-shared.js");
  const { pool } = await import("../src/db/pool.js");
  t.mock.method(pool, "query", async () => ({ rows: [], rowCount: 0 }));
  for (const name of [
    "api",
    "ai",
    "assistant-background",
    "assistant-overnight",
    "files",
    "realtime",
    "mcp",
    "plugin",
    "all",
  ] as const) {
    await assert.rejects(
      createService(name, []),
      /require an idempotency installer/,
    );
  }
  const order: string[] = [];
  const app = await createService(
    "api",
    [
      async (app) => {
        order.push("module");
        app.post("/composition-proof", async () => {
          order.push("handler");
          return { changed: true };
        });
      },
    ],
    (app) => {
      order.push("installer");
      app.addHook("preHandler", async (_request, reply) => {
        order.push("guard");
        return reply.code(409).send({ message: "guarded" });
      });
    },
  );
  try {
    const response = await app.inject({
      method: "POST",
      url: "/composition-proof",
      payload: {},
    });
    assert.equal(response.statusCode, 409, response.body);
    assert.deepEqual(order, ["installer", "module", "guard"]);
  } finally {
    await app.close();
  }
});
