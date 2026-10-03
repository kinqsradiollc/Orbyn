import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import {
  HttpError,
  errorMessage,
  errorDetail,
  OFFLINE_MESSAGE,
} from "@orbyn/core";

function fixture(mobile: boolean, development: boolean, flag?: string) {
  const path = mobile
    ? "../../mobile/src/lib/errors.ts"
    : "../../desktop/src/lib/errors.ts";
  const source = readFileSync(
    new URL(path, import.meta.url),
    "utf8",
  ).replaceAll("import.meta.env", "buildFlags");
  const exports: {
    DEBUG_ERRORS?: boolean;
    errorText?: (error: unknown, context?: string) => string;
  } = {};
  const diagnostics: { detail: string; context?: string }[] = [];
  runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText,
    {
      exports,
      __DEV__: development,
      buildFlags: { DEV: development, VITE_DEBUG_ERRORS: flag },
      process: { env: { EXPO_PUBLIC_DEBUG_ERRORS: flag } },
      require: () => ({
        errorMessage,
        logError: (error: unknown, context?: string) =>
          diagnostics.push({ detail: errorDetail(error), context }),
      }),
    },
  );
  return { ...exports, diagnostics };
}

for (const mobile of [false, true]) {
  test(`${mobile ? "mobile" : "web/desktop"} uses plain action errors in development and production`, () => {
    const error = new HttpError(401, "Email or password is incorrect", {
      detail: "fixture diagnostic",
      request: { method: "POST", path: "/auth/login", id: "fixture-request" },
    });
    for (const development of [false, true])
      for (const flag of [undefined, "false", "TRUE", "1"]) {
        const client = fixture(mobile, development, flag);
        assert.equal(client.DEBUG_ERRORS, false);
        assert.equal(
          client.errorText!(error, "Sign in"),
          "Email or password is incorrect",
        );
        assert.equal(client.diagnostics.length, 1);
        assert.equal(client.diagnostics[0].context, "Sign in");
        assert.match(
          client.diagnostics[0].detail,
          /POST \/auth\/login.*401.*fixture diagnostic.*fixture-request/,
        );
      }
  });
  test(`${mobile ? "mobile" : "web/desktop"} retains explicitly enabled diagnostics and network guidance`, () => {
    const client = fixture(mobile, true, "true");
    assert.equal(client.DEBUG_ERRORS, true);
    assert.match(
      client.errorText!(
        new HttpError(429, "Try again shortly", {
          request: { method: "GET", path: "/me", id: "fixture" },
        }),
      ),
      /Try again shortly.*GET \/me.*429.*fixture/,
    );
    assert.equal(
      fixture(mobile, true).errorText!(new TypeError("Failed to fetch")),
      OFFLINE_MESSAGE,
    );
  });
}
