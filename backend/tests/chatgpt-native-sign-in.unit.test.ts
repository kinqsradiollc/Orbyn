import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createRequire } from "node:module";
import {
  randomBytes,
  randomUUID,
  createHash,
  generateKeyPairSync,
  sign,
} from "node:crypto";
import ts from "typescript";
import * as core from "@orbyn/core";
import * as api from "@orbyn/api-client";
import {
  chatgptInferenceProofMessage,
  verifyChatgptExecutorProof,
} from "../src/modules/auth/chatgpt-executor-proof.js";

const userId = "fbb2cfcc-7052-407f-9ee5-07a0be261382";
const connection = {
  id: "36675278-d840-4d35-86ba-6af604b3b52b",
  issuer: "https://auth.openai.com",
  subject: "fixture-subject",
  client_id: "oaiapp_fixture",
};
const tokens = {
  access_token: "private-access",
  refresh_token: "private-refresh",
  id_token: "identity-proof",
  expires_in: 3600,
  token_type: "Bearer",
  scope: "openid resource.invoke chatgpt.tokens.use.direct offline_access",
};

function mount(
  options: {
    platform?: string;
    available?: boolean;
    scopes?: string;
    consumeRefresh?: boolean;
    failRotatedStore?: boolean;
    callback?: "wrong" | "denied";
    identity?: object;
    changeSession?: "finish" | "store" | "delete";
    me?: string;
    browserCancel?: boolean;
    revoked?: boolean;
    revokeFailure?: boolean;
    keyRemovalFailure?: boolean;
    credentialRemovalFailure?: boolean;
    onStorageRead?: (key: string) => void;
    providerRevokeFailure?: boolean;
    holdCallback?: boolean;
    onRevoke?: () => Promise<void>;
    refreshedId?: boolean;
    refreshIdentity?: object;
    failRefreshProof?: boolean;
    onRefresh?: () => Promise<void>;
    refreshError?: { status: number; code: string };
    failMappingStore?: boolean;
    onFinish?: () => void;
    onDirectoryWrite?: () => void;
    liveConnections?: (typeof connection)[];
    signing?: boolean;
    inference?: "success" | "limit" | "session";
    providerToken?: () => string;
    onResponses?: () => Promise<void>;
    changeDuringModels?: "session" | "registration";
  } = {},
) {
  const storage = new Map<string, string>();
  const consumedRefresh = new Set<string>();
  const signingAliases: string[] = [],
    removedAliases: string[] = [];
  const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicKey = pair.publicKey
    .export({ type: "spki", format: "der" })
    .toString("base64url");
  const fingerprint = createHash("sha256")
    .update(Buffer.from(publicKey, "base64url"))
    .digest("base64url");
  let executorId = randomUUID();
  let executorBinding = {
    user_id: userId,
    connection_id: connection.id,
    issuer: connection.issuer,
    subject: connection.subject,
    client_id: connection.client_id,
  };
  let executorHost = "";
  const executorLease = () => ({
    executor_id: executorId,
    binding: executorBinding,
    enrollment_epoch: 1,
    lease_epoch: 1,
    expires_at: new Date(Date.now() + 60000).toISOString(),
  });
  const session = { token: "owned-session" };
  const calls = {
    network: 0,
    proof: [] as any[],
    started: 0,
    stopped: 0,
    opened: [] as string[],
    dismissed: 0,
    freshMe: false,
    revoked: [] as string[],
    providerRevoked: [] as string[],
    refreshed: 0,
    keyRemoved: 0,
    catalogs: [] as object[],
    publications: [] as any[],
    responses: 0,
    modelTokens: [] as string[],
    responseTokens: [] as string[],
    refreshProof: [] as object[],
  };
  let state = "",
    redirect = "http://127.0.0.1:1455/auth/callback";
  let dismiss!: (value: object) => void;
  let rejectWait: ((error: Error) => void) | null = null;
  const exports: any = {};
  const compiled = ts.transpileModule(
    readFileSync(
      new URL("../../mobile/src/lib/chatgpt-local-sign-in.ts", import.meta.url),
      "utf8",
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  runInNewContext(compiled, {
    exports,
    URL,
    URLSearchParams,
    AbortController,
    TextDecoder,
    setTimeout,
    clearTimeout,
    require: function moduleRequire(id: string): any {
      if (
        [
          "./chatgpt-protected-store",
          "./chatgpt-account-directory",
          "./chatgpt-account-migration",
        ].includes(id)
      ) {
        const nested: any = {};
        runInNewContext(
          ts.transpileModule(
            readFileSync(
              new URL(
                `../../mobile/src/lib/${id.slice(2)}.ts`,
                import.meta.url,
              ),
              "utf8",
            ),
            {
              compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES2022,
              },
            },
          ).outputText,
          { exports: nested, URL, Promise, Map, Set, require: moduleRequire },
        );
        return nested;
      }
      if (id === "@orbyn/core") return core;
      if (id === "@orbyn/api-client") return api;
      if (id === "zod") return { z };
      if (id === "react-native")
        return { Platform: { OS: options.platform ?? "ios" } };
      if (id === "./session") return { session };
      if (id === "./device")
        return {
          deviceLabel: () =>
            options.platform === "android" ? "Pixel QA" : "iPhone QA",
        };
      if (id === "expo-crypto")
        return {
          randomUUID,
          getRandomBytesAsync: async (size: number) => randomBytes(size),
          CryptoDigestAlgorithm: { SHA256: "sha256" },
          CryptoEncoding: { BASE64: "base64" },
          digestStringAsync: async (
            _algorithm: string,
            value: string,
            encoding: any,
          ) =>
            createHash("sha256")
              .update(value)
              .digest(encoding?.encoding ?? "hex"),
        };
      if (id === "expo-secure-store")
        return {
          WHEN_UNLOCKED_THIS_DEVICE_ONLY: "protected-device-only",
          getItemAsync: async (key: string) => {
            options.onStorageRead?.(key);
            return storage.get(key) ?? null;
          },
          setItemAsync: async (key: string, value: string, config: any) => {
            assert.equal(config.keychainAccessible, "protected-device-only");
            if (
              options.failMappingStore &&
              (key.includes(".registration.") ||
                key.includes(".slot-registration."))
            )
              throw new Error("private-access storage failure");
            if (
              options.failRotatedStore &&
              key.includes(".account.") &&
              JSON.parse(value).grant?.refreshToken === "refreshed-refresh"
            )
              throw new Error("replacement storage unavailable");
            storage.set(key, value);
            if (key.includes(".directory.")) options.onDirectoryWrite?.();
            if (options.changeSession === "store" && key.includes(".account."))
              session.token = "other-session";
          },
          deleteItemAsync: async (key: string) => {
            if (
              options.credentialRemovalFailure &&
              (key.includes(".account.") || key.includes(".slot."))
            )
              throw new Error("private-token erase failure");
            storage.delete(key);
            if (options.changeSession === "delete")
              session.token = "other-session";
          },
        };
      if (id === "expo/fetch")
        return {
          fetch: async (url: string, init: any) => {
            calls.network++;
            if (url === "https://api.openai.com/v1/models") {
              calls.modelTokens.push(init.headers.Authorization);
              assert.equal(
                init.headers.Authorization,
                options.providerToken
                  ? `Bearer ${options.providerToken()}`
                  : calls.refreshed
                    ? "Bearer refreshed-access"
                    : "Bearer private-access",
              );
              if (options.changeDuringModels === "session")
                session.token = "other-session";
              if (options.changeDuringModels === "registration") {
                for (const [key, value] of storage)
                  if (key.includes(".account."))
                    storage.set(
                      key,
                      JSON.stringify({
                        ...JSON.parse(value),
                        revision: randomUUID(),
                      }),
                    );
              }
              return Response.json({
                models: [
                  {
                    slug: "native-model",
                    display_name: "Native model",
                    visibility: "list",
                  },
                ],
              });
            }
            if (url === "https://api.openai.com/v1/responses") {
              calls.responses++;
              assert.equal(
                init.headers.Authorization,
                options.providerToken
                  ? `Bearer ${options.providerToken()}`
                  : calls.refreshed
                    ? "Bearer refreshed-access"
                    : "Bearer private-access",
              );
              calls.responseTokens.push(init.headers.Authorization);
              await options.onResponses?.();
              const body = JSON.parse(init.body);
              assert.equal(body.store, false);
              assert.equal(body.stream, true);
              assert.equal(body.model, "native-model");
              assert.equal(body.input[0].content, "Owned private task");
              if (options.inference === "session")
                session.token = "other-session";
              if (options.inference === "limit")
                return Response.json(
                  {
                    error: {
                      code: "subscription_sharing_usage_limit_exceeded",
                      message: "private provider detail",
                    },
                  },
                  { status: 429 },
                );
              return new Response(
                "data: " +
                  JSON.stringify({
                    type: "response.output_text.delta",
                    delta: "Actual nonempty fixture answer",
                  }) +
                  "\n\n" +
                  "data: " +
                  JSON.stringify({
                    type: "response.completed",
                    response: {
                      status: "completed",
                      usage: {
                        input_tokens: 4,
                        output_tokens: 5,
                        total_tokens: 9,
                      },
                    },
                  }) +
                  "\n\n",
                { headers: { "content-type": "text/event-stream" } },
              );
            }
            if (
              url === "https://auth.openai.com/.well-known/openid-configuration"
            ) {
              assert.equal(init.body, undefined);
              return Response.json({
                issuer: "https://auth.openai.com",
                revocation_endpoint:
                  "https://auth.openai.com/api/accounts/oauth/revoke",
              });
            }
            if (url === "https://auth.openai.com/api/accounts/oauth/revoke") {
              calls.providerRevoked.push(init.body.get("token"));
              assert.equal(
                init.body.get("client_id"),
                (options.connection?.() ?? connection).client_id,
              );
              assert.equal(init.body.get("token_type_hint"), "refresh_token");
              assert.ok(
                accounts(storage).some(
                  ([, raw]) =>
                    JSON.parse(raw).grant?.refreshToken ===
                    init.body.get("token"),
                ),
              );
              return new Response(null, {
                status: options.providerRevokeFailure ? 503 : 200,
              });
            }
            assert.equal(
              url,
              "https://auth.openai.com/api/accounts/oauth/token",
            );
            assert.equal(
              init.body.get("client_id"),
              (options.connection?.() ?? connection).client_id,
            );
            if (init.body.get("grant_type") === "refresh_token") {
              calls.refreshed++;
              if (options.consumeRefresh) {
                const token = init.body.get("refresh_token");
                assert.equal(
                  consumedRefresh.has(token),
                  false,
                  "provider rejects consumed refresh token reuse",
                );
                consumedRefresh.add(token);
              }
              await options.onRefresh?.();
              if (options.refreshError)
                return Response.json(
                  { error: options.refreshError.code },
                  { status: options.refreshError.status },
                );
              return Response.json({
                ...tokens,
                access_token: "refreshed-access",
                refresh_token: "refreshed-refresh",
                id_token: options.refreshedId
                  ? "refreshed-identity"
                  : tokens.id_token,
                scope: options.scopes ?? tokens.scope,
              });
            }
            return Response.json({
              ...tokens,
              scope: options.scopes ?? tokens.scope,
            });
          },
        };
      if (id === "expo-web-browser")
        return {
          WebBrowserResultType: { OPENED: "opened" },
          openBrowserAsync: (url: string) => {
            calls.opened.push(url);
            if (options.browserCancel)
              return Promise.resolve({ type: "cancel" });
            return new Promise((resolve) => {
              dismiss = resolve;
            });
          },
          dismissBrowser: () => {
            calls.dismissed++;
            dismiss?.({ type: "dismiss" });
          },
        };
      if (id === "../../modules/orbyn-chatgpt")
        return {
          nativeChatgptSigningAvailable: () => options.signing === true,
          nativeChatgptKeyMetadata: async (alias: string) => {
            assert.match(alias, /^[a-f0-9]{64}$/);
            signingAliases.push(alias);
            return {
              public_key: publicKey,
              public_key_fingerprint: fingerprint,
            };
          },
          signNativeChatgptProof: async (
            alias: string,
            expected: string,
            message: string,
          ) => {
            assert.match(alias, /^[a-f0-9]{64}$/);
            assert.equal(expected, fingerprint);
            return sign("sha256", Buffer.from(message), {
              key: pair.privateKey,
              dsaEncoding: "ieee-p1363",
            }).toString("base64url");
          },
          removeNativeChatgptKey: async (alias: string) => {
            assert.match(alias, /^[a-f0-9]{64}$/);
            calls.keyRemoved++;
            removedAliases.push(alias);
            if (options.keyRemovalFailure)
              throw new Error("private-key erase failure");
          },
          nativeChatgptCallbackAvailable: () => options.available !== false,
          startNativeChatgptCallback: async (_id: string, value: string) => {
            calls.started++;
            state = value;
            return redirect;
          },
          waitNativeChatgptCallback: async () => {
            if (options.browserCancel || options.holdCallback)
              return new Promise((_resolve, reject) => {
                rejectWait = reject;
              });
            return (
              redirect +
              "?" +
              new URLSearchParams({
                state: options.callback === "wrong" ? "wrong" : state,
                code: "fixture-code",
                client_id: (options.connection?.() ?? connection).client_id,
                ...(options.callback === "denied"
                  ? { error: "access_denied" }
                  : {}),
              })
            );
          },
          cancelNativeChatgptCallback: async () => {
            calls.stopped++;
            rejectWait?.(new Error("cancelled"));
          },
        };
      if (id === "./api")
        return {
          client: {
            baseUrl: "https://orbyn.example/api",
            beginChatgptExecutor: async (input: any) => {
              const owned = (options.liveConnections ?? [connection]).find(
                (row) => row.id === input.connection_id,
              );
              assert.ok(owned, "enrollment must use an owned connection");
              assert.equal(input.device?.type, options.platform ?? "ios");
              assert.equal(
                input.device?.name,
                options.platform === "android" ? "Pixel QA" : "iPhone QA",
              );
              executorId = randomUUID();
              executorBinding = {
                user_id: userId,
                connection_id: owned.id,
                issuer: owned.issuer,
                subject: owned.subject,
                client_id: owned.client_id,
              };
              executorHost = input.host_id;
              const id = randomUUID();
              return {
                id,
                binding: executorBinding,
                host_id: executorHost,
                public_key_fingerprint: fingerprint,
                expires_at: new Date(Date.now() + 60000).toISOString(),
                proof_message: JSON.stringify([
                  "orbyn:executor:enroll:v1",
                  id,
                  randomUUID(),
                  executorBinding,
                  executorHost,
                  fingerprint,
                  0,
                  null,
                  "n".repeat(43),
                ]),
              };
            },
            finishChatgptExecutor: async () => ({
              id: executorId,
              binding: executorBinding,
              host_id: executorHost,
              public_key_fingerprint: fingerprint,
              enrollment_epoch: 1,
            }),
            beginChatgptExecutorLease: async () => {
              const id = randomUUID();
              return {
                id,
                executor_id: executorId,
                binding: executorBinding,
                enrollment_epoch: 1,
                expected_lease_epoch: 0,
                expires_at: new Date(Date.now() + 60000).toISOString(),
                proof_message: JSON.stringify([
                  "orbyn:executor:lease-claim:v1",
                  id,
                  randomUUID(),
                  executorBinding,
                  executorId,
                  1,
                  0,
                  "n".repeat(43),
                ]),
              };
            },
            finishChatgptExecutorLease: async () => executorLease(),
            renewChatgptExecutorLease: async () => executorLease(),
            publishChatgptModels: async (value: any) => {
              calls.catalogs.push(value.catalog);
              assert.deepEqual(Array.from(value.catalog.capabilities), [
                "plan_inference_v1",
              ]);
              return {
                executor_id: executorId,
                lease_epoch: 1,
                sequence: value.catalog.sequence,
                published_at: new Date().toISOString(),
              };
            },
            claimChatgptInference: async (id: string) => {
              assert.equal(id, executorId);
              if (!options.inference) return null;
              const assignment = {
                id: randomUUID(),
                job_id: randomUUID(),
                executor_id: executorId,
                binding: executorBinding,
                enrollment_epoch: 1,
                lease_epoch: 1,
                model: "native-model",
                nonce: "n".repeat(43),
                request_hash: "",
                expires_at: new Date(Date.now() + 60000).toISOString(),
                payload: {
                  instructions: "Owned instructions",
                  input: [{ role: "user", content: "Owned private task" }],
                },
              };
              assignment.request_hash = createHash("sha256")
                .update(
                  JSON.stringify({
                    binding: assignment.binding,
                    model: assignment.model,
                    payload: assignment.payload,
                    job_id: assignment.job_id,
                  }),
                )
                .digest("hex");
              return assignment;
            },
            finishChatgptInference: async (value: any) => {
              verifyChatgptExecutorProof(
                publicKey,
                chatgptInferenceProofMessage(value.receipt, value.proof_format),
                value.signature,
              );
              calls.publications.push(value);
            },
            me: async (settings: any) => {
              calls.freshMe = settings.fresh;
              return { id: options.me ?? userId };
            },
            verifyChatgptRefreshIdentity: async (input: object) => {
              calls.refreshProof.push(input);
              if (options.failRefreshProof)
                throw new Error("Invalid identity proof");
              return { ...connection, ...options.refreshIdentity };
            },
            revokeChatgptConnection: async (id: string) => {
              calls.revoked.push(id);
              if (!options.credentialRemovalFailure)
                assert.equal(
                  accounts(storage).some(
                    ([, raw]) => JSON.parse(raw).connection.id === id,
                  ),
                  false,
                );
              if (options.revokeFailure)
                throw new Error("private-refresh provider outage");
              await options.onRevoke?.();
            },
            chatgptConnections: async () =>
              options.revoked
                ? []
                : (options.liveConnections ?? [connection]).map((row) => ({
                    ...row,
                    verified_at: new Date().toISOString(),
                  })),
            startChatgptConnection: async () => ({
              id: randomUUID(),
              nonce: "n".repeat(43),
              expires_at: new Date(Date.now() + 600000).toISOString(),
            }),
            finishChatgptConnection: async (proof: any) => {
              calls.proof.push(proof);
              options.onFinish?.();
              if (options.changeSession === "finish")
                session.token = "other-session";
              return {
                ...(options.connection?.() ?? connection),
                ...options.identity,
              };
            },
          },
        };
      throw new Error("Unexpected module " + id);
    },
  });
  return {
    savedAccounts: (input = userId, signal?: AbortSignal) =>
      exports.readNativeChatgptAccounts(input, { signal }),
    chooseAccount: (
      connectionId: string,
      revision: string,
      signal?: AbortSignal,
    ) =>
      exports.selectNativeChatgptAccount(userId, connectionId, revision, {
        signal,
      }),
    prepare: (input = userId, signal?: AbortSignal) =>
      exports.prepareNativeChatgptAccounts(input, { signal }),
    signIn: (input = userId, action?: unknown) =>
      exports.signInNativeChatgpt(input, { action }),
    cancel: () => exports.cancelNativeChatgptSignIn(),
    accountState: (input = userId, signal?: AbortSignal) =>
      exports.readNativeChatgptAccountState(input, { signal }),
    disconnect: (input = userId, target?: unknown) =>
      exports.disconnectNativeChatgpt(input, { target }),
    executor: (input = userId) => exports.createNativeChatgptExecutor(input),
    models: (input = userId, signal?: AbortSignal) =>
      exports.readNativeChatgptModels(input, { signal }),
    storage,
    signingAliases,
    removedAliases,
    session,
    calls,
  };
}
import { z } from "zod";
const accounts = (storage: Map<string, string>) =>
  [...storage].filter(
    ([key]) => key.includes(".account.") || key.includes(".slot."),
  );

test("actual native sign-in service authorizes locally, verifies only ID proof remotely and stores protected credentials", async () => {
  const fixture = mount();
  const result = await fixture.signIn();
  assert.equal(result.sharingGranted, true);
  assert.equal(result.connection.id, connection.id);
  assert.equal(fixture.calls.freshMe, true);
  assert.equal(fixture.calls.started, 1);
  assert.equal(fixture.calls.network, 1);
  assert.equal(fixture.calls.proof.length, 1);
  assert.deepEqual(Object.keys(fixture.calls.proof[0]).sort(), [
    "challenge_id",
    "client_id",
    "id_token",
  ]);
  const url = new URL(fixture.calls.opened[0]);
  assert.equal(url.searchParams.get("client_id"), "dynamic_agent_client");
  assert.equal(url.searchParams.get("agent_name_hint"), "Orbyn");
  assert.equal(url.searchParams.get("nonce"), "n".repeat(43));
  assert.equal(accounts(fixture.storage).length, 1);
  assert.equal(
    JSON.parse(accounts(fixture.storage)[0][1]).grant.accessToken,
    "private-access",
  );
  assert.equal("grant" in result, false);
  assert.equal(fixture.calls.dismissed, 1);
  assert.ok(fixture.calls.stopped >= 1);
});
test("native reconnect reuses the issued registration, host and verified identity", async () => {
  const fixture = mount();
  await fixture.signIn();
  await fixture.signIn();
  const first = new URL(fixture.calls.opened[0]),
    second = new URL(fixture.calls.opened[1]);
  assert.equal(second.searchParams.get("client_id"), "oaiapp_fixture");
  assert.equal(
    second.searchParams.get("ext_agent_host_id"),
    first.searchParams.get("ext_agent_host_id"),
  );
  assert.equal(second.searchParams.get("id_token_hint"), "identity-proof");
  assert.equal(second.searchParams.has("agent_name_hint"), false);
});
test("web, missing native build and foreign Orbyn account do not queue a desktop request", async () => {
  for (const options of [
    { platform: "web" },
    { available: false },
    { me: randomUUID() },
  ]) {
    const fixture = mount(options);
    await assert.rejects(fixture.signIn());
    assert.equal(fixture.calls.started, 0);
    assert.equal(fixture.calls.network, 0);
    assert.equal(accounts(fixture.storage).length, 0);
  }
});
test("wrong state and denied callback never exchange credentials", async () => {
  for (const callback of ["wrong", "denied"] as const) {
    const fixture = mount({ callback });
    await assert.rejects(fixture.signIn());
    assert.equal(fixture.calls.network, 0);
    assert.equal(fixture.calls.proof.length, 0);
    assert.equal(accounts(fixture.storage).length, 0);
    assert.ok(fixture.calls.stopped >= 1);
  }
});
test("changed verified identity cannot install a provider", async () => {
  for (const options of [{ identity: { client_id: "oaiapp_other" } }]) {
    const fixture = mount(options);
    await assert.rejects(fixture.signIn());
    assert.equal(accounts(fixture.storage).length, 0);
  }
});
test("session change during remote proof or secure write cannot keep the new credentials", async () => {
  for (const changeSession of ["finish", "store"] as const) {
    const fixture = mount({ changeSession });
    await assert.rejects(fixture.signIn());
    assert.equal(accounts(fixture.storage).length, 0);
  }
});
test("native browser cancellation aborts the exact listener without writing credentials", async () => {
  const fixture = mount({ browserCancel: true });
  await assert.rejects(fixture.signIn());
  assert.equal(fixture.calls.network, 0);
  assert.equal(accounts(fixture.storage).length, 0);
  assert.ok(fixture.calls.stopped >= 1);
});

test("concurrent native sign-in cannot replace the winning attempt", async () => {
  const fixture = mount();
  const first = fixture.signIn();
  await assert.rejects(fixture.signIn());
  await first;
  assert.equal(fixture.calls.started, 1);
  assert.equal(accounts(fixture.storage).length, 1);
});
test("cancelled secure replacement restores the prior account record", async () => {
  const options: { changeSession?: "finish" | "store" } = {};
  const fixture = mount(options);
  await fixture.signIn();
  const original = accounts(fixture.storage)[0][1];
  options.changeSession = "store";
  await assert.rejects(fixture.signIn());
  assert.equal(accounts(fixture.storage)[0][1], original);
});
test("corrupt protected records are preserved and never copied into diagnostic errors", async () => {
  const fixture = mount();
  await fixture.signIn();
  const key = accounts(fixture.storage)[0][0];
  const corrupt = "private-access-malformed-json";
  fixture.storage.set(key, corrupt);
  await assert.rejects(fixture.signIn(), (error: unknown) => {
    const message = String(error);
    return (
      message.includes("saved ChatGPT connection is unavailable") &&
      !message.includes(corrupt)
    );
  });
  assert.equal(fixture.storage.get(key), corrupt);
});

test("native models use only a protected, currently owned and live connection", async () => {
  const fixture = mount();
  await fixture.signIn();
  const result = await fixture.models();
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    connection,
    models: [{ slug: "native-model", display_name: "Native model" }],
  });
  assert.equal(JSON.stringify(result).includes("private-access"), false);
});
test("native model discovery rejects revoked server identity before requesting models", async () => {
  const fixture = mount({ revoked: true });
  await fixture.signIn();
  const before = fixture.calls.network;
  await assert.rejects(fixture.models(), /Reconnect/);
  assert.equal(fixture.calls.network, before);
});
test("native models discard late results after session or protected registration changes", async () => {
  for (const changeDuringModels of ["session", "registration"] as const) {
    const fixture = mount({ changeDuringModels });
    await fixture.signIn();
    await assert.rejects(fixture.models(), /changed/);
  }
});
test("native models reject missing registration, wrong owner, cancellation and web runtime", async () => {
  await assert.rejects(mount().models(), /Connect ChatGPT/);
  const fixture = mount();
  await fixture.signIn();
  await assert.rejects(fixture.models(randomUUID()), /account changed/);
  await assert.rejects(fixture.models(userId, AbortSignal.abort()), /changed/);
  await assert.rejects(mount({ platform: "web" }).models(), /native ChatGPT/);
});

test("native disconnect erases protected credentials before revoking exact server identity", async () => {
  const fixture = mount();
  await fixture.signIn();
  await fixture.disconnect();
  assert.equal(accounts(fixture.storage).length, 0);
  assert.deepEqual(fixture.calls.revoked, [connection.id]);
  assert.equal(
    [...fixture.storage.keys()].some((key) => key.includes(".host.")),
    true,
  );
  await assert.rejects(fixture.models(), /Connect ChatGPT/);
  await fixture.disconnect();
  assert.deepEqual(fixture.calls.revoked, [connection.id, connection.id]);
});
test("native disconnect cannot retain tokens when server revocation fails", async () => {
  const fixture = mount({ revokeFailure: true });
  await fixture.signIn();
  await assert.rejects(fixture.disconnect(), (error: unknown) => {
    assert.match(String(error), /removed from this device/);
    assert.doesNotMatch(String(error), /private-refresh/);
    return true;
  });
  assert.equal(accounts(fixture.storage).length, 0);
});
test("corrupted native registrations can be erased without guessing a server connection", async () => {
  const fixture = mount();
  await fixture.signIn();
  const [key] = accounts(fixture.storage)[0];
  fixture.storage.set(key, "private-access invalid record");
  await fixture.disconnect();
  assert.equal(accounts(fixture.storage).length, 0);
  assert.equal(fixture.calls.revoked.length, 0);
});
test("disconnect rejects a foreign Orbyn owner and web without deleting credentials", async () => {
  const fixture = mount();
  await fixture.signIn();
  await assert.rejects(fixture.disconnect(randomUUID()), /account changed/);
  assert.equal(accounts(fixture.storage).length, 1);
  assert.equal(fixture.calls.revoked.length, 0);
  await assert.rejects(
    mount({ platform: "web" }).disconnect(),
    /native ChatGPT/,
  );
});
test("disconnect serializes against sign-in and another disconnect", async () => {
  let entered!: () => void;
  const reached = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fixture = mount({
    onRevoke: async () => {
      entered();
      await blocked;
    },
  });
  await fixture.signIn();
  const disconnect = fixture.disconnect();
  await reached;
  await assert.rejects(fixture.signIn(), /current ChatGPT action/);
  await assert.rejects(fixture.disconnect(), /already in progress/);
  await assert.rejects(fixture.models(), /changed/);
  release();
  await disconnect;
  await fixture.signIn();
  assert.equal(accounts(fixture.storage).length, 1);
});
test("disconnect cancels and awaits an active callback before reading local credentials", async () => {
  const fixture = mount({ holdCallback: true });
  const signIn = fixture.signIn();
  const rejected = assert.rejects(signIn);
  // Wait for the actual source service's listener to start, not an arbitrary delay.
  for (let index = 0; index < 100 && fixture.calls.started === 0; index++)
    await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(fixture.calls.started, 1);
  await fixture.disconnect();
  await rejected;
  assert.equal(accounts(fixture.storage).length, 0);
  assert.equal(fixture.calls.revoked.length, 0);
});

test("session change during local removal prevents revoking through another session", async () => {
  const fixture = mount({ changeSession: "delete" });
  await fixture.signIn();
  await assert.rejects(fixture.disconnect(), /account changed/);
  assert.equal(accounts(fixture.storage).length, 0);
  assert.equal(fixture.calls.revoked.length, 0);
});

function expireSoon(fixture: ReturnType<typeof mount>) {
  const [key, json] = accounts(fixture.storage)[0];
  const saved = JSON.parse(json);
  saved.grant.expiresAt = Date.now() + 1000;
  fixture.storage.set(key, JSON.stringify(saved));
  return fixture.storage.get(key);
}
test("native near-expiry model discovery rotates local tokens after verifying changed identity", async () => {
  const fixture = mount({ refreshedId: true });
  await fixture.signIn();
  expireSoon(fixture);
  await fixture.models();
  assert.equal(fixture.calls.refreshed, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(fixture.calls.refreshProof)), [
    { connection_id: connection.id, id_token: "refreshed-identity" },
  ]);
  const saved = JSON.parse(accounts(fixture.storage)[0][1]);
  assert.equal(saved.grant.accessToken, "refreshed-access");
  assert.equal(saved.grant.refreshToken, "refreshed-refresh");
  await fixture.models();
  assert.equal(fixture.calls.refreshed, 1);
});
test("unchanged refresh identity needs no new sign-in proof but retains the original account", async () => {
  const fixture = mount();
  await fixture.signIn();
  expireSoon(fixture);
  await fixture.models();
  assert.equal(fixture.calls.refreshProof.length, 0);
  assert.equal(fixture.calls.refreshed, 1);
  assert.deepEqual(
    JSON.parse(accounts(fixture.storage)[0][1]).connection,
    connection,
  );
});
test("altered or unverified refreshed identity retires the consumed grant", async () => {
  for (const options of [
    { refreshedId: true, refreshIdentity: { subject: "foreign-subject" } },
    { refreshedId: true, failRefreshProof: true },
  ]) {
    const fixture = mount(options);
    await fixture.signIn();
    const original = expireSoon(fixture);
    await assert.rejects(fixture.models());
    const retired = JSON.parse(accounts(fixture.storage)[0][1]);
    assert.equal(retired.version, 2);
    assert.equal(retired.grant, null);
    await assert.rejects(fixture.models());
    assert.equal(fixture.calls.refreshed, 1);
  }
});
test("refresh scope reduction persists rotated tokens but cannot request a model catalog", async () => {
  const options: { scopes?: string } = {};
  const fixture = mount(options);
  await fixture.signIn();
  expireSoon(fixture);
  options.scopes = "openid offline_access";
  const before = fixture.calls.network;
  await assert.rejects(fixture.models());
  assert.equal(fixture.calls.network, before + 1);
  const saved = JSON.parse(accounts(fixture.storage)[0][1]);
  assert.equal(saved.grant.sharingGranted, false);
  assert.equal(saved.grant.refreshToken, "refreshed-refresh");
});

test("disconnect aborts pending refresh and cannot reinstall credentials afterward", async () => {
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fixture = mount({
    onRefresh: async () => {
      entered();
      await pending;
    },
  });
  await fixture.signIn();
  expireSoon(fixture);
  const models = fixture.models();
  const rejected = assert.rejects(models);
  await started;
  await fixture.disconnect();
  await rejected;
  release();
  await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(accounts(fixture.storage).length, 0);
  assert.equal(fixture.calls.refreshProof.length, 0);
});
test("session changes during rotation never restore a consumed refresh token", async () => {
  const options: { changeSession?: "finish" | "store" } = {};
  const fixture = mount(options);
  await fixture.signIn();
  const original = expireSoon(fixture);
  options.changeSession = "store";
  await assert.rejects(fixture.models(), /changed/);
  const retired = JSON.parse(accounts(fixture.storage)[0][1]);
  assert.equal(retired.version, 2);
  assert.equal(retired.grant, null);
  assert.notEqual(accounts(fixture.storage)[0][1], original);
});

test("actual native executor factory publishes local account models and disconnect closes it and removes its key", async () => {
  const fixture = mount({ signing: true });
  await fixture.signIn();
  const runtime = await fixture.executor();
  const started = await runtime.start();
  assert.equal(started.selection.connection_id, connection.id);
  assert.equal(fixture.calls.catalogs.length, 1);
  await runtime.heartbeat();
  await fixture.disconnect();
  assert.equal(fixture.calls.keyRemoved, 1);
  await assert.rejects(runtime.heartbeat());
});
test("native executor replacement and reconnect invalidate an older runtime", async () => {
  const fixture = mount({ signing: true });
  await fixture.signIn();
  const older = await fixture.executor();
  const replacement = await fixture.executor();
  await assert.rejects(older.start());
  await replacement.start();
  await fixture.signIn();
  await assert.rejects(replacement.heartbeat());
});
test("native executor refuses web and installed builds without signing support", async () => {
  await assert.rejects(mount().executor(), /executor signing/);
  await assert.rejects(
    mount({ platform: "web", signing: true }).executor(),
    /executor signing/,
  );
});

test("actual native factory executes owned inference locally and publishes verified measured completion", async () => {
  const f = mount({ signing: true, inference: "success" });
  await f.signIn();
  expireSoon(f);
  const runtime = await f.executor();
  await runtime.start();
  assert.deepEqual(await runtime.executeNext(), { processed: true });
  assert.equal(f.calls.refreshed, 1);
  assert.equal(f.calls.responses, 1);
  const result = f.calls.publications[0].receipt.result;
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    status: "completed",
    text: "Actual nonempty fixture answer",
    usage: { input_tokens: 4, output_tokens: 5, total_tokens: 9 },
  });
  assert.equal(f.calls.publications[0].proof_format, "sha256_v2");
  assert.ok(!JSON.stringify(f.calls.publications).includes("private-access"));
  runtime.close();
});
test("native provider usage rejection publishes sanitized admission failure without retry", async () => {
  const f = mount({ signing: true, inference: "limit" });
  await f.signIn();
  const runtime = await f.executor();
  await runtime.start();
  await runtime.executeNext();
  assert.equal(f.calls.responses, 1);
  const result = f.calls.publications[0].receipt.result;
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    status: "failed",
    reason: "usage_limit",
    phase: "admission",
    http_status: 429,
    provider_code: "subscription_sharing_usage_limit_exceeded",
  });
  assert.ok(
    !JSON.stringify(f.calls.publications).includes("private provider detail"),
  );
  runtime.close();
});
test("native session change during provider transport cannot publish a completion", async () => {
  const f = mount({ signing: true, inference: "session" });
  await f.signIn();
  const runtime = await f.executor();
  await runtime.start();
  await assert.rejects(runtime.executeNext());
  assert.equal(f.calls.responses, 1);
  assert.equal(f.calls.publications.length, 0);
  runtime.close();
});

test("concurrent native catalog reads share one verified token rotation and use the new grant", async () => {
  let entered!: (value?: unknown) => void, release!: (value?: unknown) => void;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  const f = mount({
    onRefresh: async () => {
      entered();
      await blocked;
    },
    refreshedId: true,
  });
  await f.signIn();
  expireSoon(f);
  const first = f.models();
  await started;
  const second = f.models();
  release();
  const results = await Promise.all([first, second]);
  assert.equal(results.length, 2);
  assert.equal(f.calls.refreshed, 1);
  assert.equal(f.calls.refreshProof.length, 1);
  assert.equal(
    JSON.parse(accounts(f.storage)[0][1]).grant.accessToken,
    "refreshed-access",
  );
});
test("an owned executor heartbeat stays live during its verified refresh but new sign-in is fenced", async () => {
  let entered!: (value?: unknown) => void, release!: (value?: unknown) => void;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  const f = mount({
    signing: true,
    onRefresh: async () => {
      entered();
      await blocked;
    },
  });
  await f.signIn();
  const runtime = await f.executor();
  await runtime.start();
  expireSoon(f);
  const models = f.models();
  await started;
  await runtime.heartbeat();
  await assert.rejects(f.signIn(), /current ChatGPT action/);
  release();
  await models;
  await runtime.heartbeat();
  runtime.close();
});
test("queued native catalog reads cannot adopt a replacement Orbyn session", async () => {
  let entered!: (value?: unknown) => void, release!: (value?: unknown) => void;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  const f = mount({
    onRefresh: async () => {
      entered();
      await blocked;
    },
  });
  await f.signIn();
  expireSoon(f);
  const first = f.models();
  const rejectedFirst = assert.rejects(first);
  await started;
  const second = f.models();
  const rejectedSecond = assert.rejects(
    second,
    /session or ChatGPT connection changed/,
  );
  f.session.token = "replacement-session";
  release();
  await Promise.all([rejectedFirst, rejectedSecond]);
  assert.equal(f.calls.refreshed, 1);
  assert.equal(f.calls.refreshProof.length, 0);
});
test("cancelled queued catalog work never performs another provider request", async () => {
  let entered!: (value?: unknown) => void, release!: (value?: unknown) => void;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  const f = mount({
    onRefresh: async () => {
      entered();
      await blocked;
    },
  });
  await f.signIn();
  expireSoon(f);
  const first = f.models();
  await started;
  const controller = new AbortController();
  const second = f.models(undefined, controller.signal);
  const rejected = assert.rejects(second);
  controller.abort();
  release();
  await first;
  const count = f.calls.network;
  await rejected;
  assert.equal(f.calls.network, count);
});

test("simultaneous native catalog and inference work share refresh without stopping the executor", async () => {
  let entered!: (value?: unknown) => void, release!: (value?: unknown) => void;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  const f = mount({
    signing: true,
    inference: "success",
    onRefresh: async () => {
      entered();
      await blocked;
    },
  });
  await f.signIn();
  const runtime = await f.executor();
  await runtime.start();
  expireSoon(f);
  const catalog = runtime.refreshCatalog();
  await started;
  const inference = runtime.executeNext();
  release();
  await Promise.all([catalog, inference]);
  await runtime.heartbeat();
  assert.equal(f.calls.refreshed, 1);
  assert.equal(f.calls.responses, 1);
  assert.equal(f.calls.catalogs.length, 2);
  assert.equal(f.calls.publications.length, 1);
  runtime.close();
});
test("disconnect aborts shared refresh and prevents queued work from restoring or using credentials", async () => {
  let entered!: (value?: unknown) => void, release!: (value?: unknown) => void;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  const f = mount({
    onRefresh: async () => {
      entered();
      await blocked;
    },
  });
  await f.signIn();
  expireSoon(f);
  const first = f.models();
  const rejectedFirst = assert.rejects(first);
  await started;
  const second = f.models();
  const rejectedSecond = assert.rejects(second);
  await f.disconnect();
  await Promise.all([rejectedFirst, rejectedSecond]);
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(accounts(f.storage).length, 0);
  assert.equal(f.calls.refreshed, 1);
  assert.equal(f.calls.refreshProof.length, 0);
});

test("native disconnect revokes the selected renewable OpenAI session before erasing it", async () => {
  const fixture = mount();
  await fixture.signIn();
  await fixture.disconnect();
  assert.deepEqual(fixture.calls.providerRevoked, ["private-refresh"]);
  assert.deepEqual(fixture.calls.revoked, [connection.id]);
  assert.equal(accounts(fixture.storage).length, 0);
});
test("native disconnect clears local and server state when OpenAI revocation is unconfirmed", async () => {
  const fixture = mount({ providerRevokeFailure: true });
  await fixture.signIn();
  await assert.rejects(fixture.disconnect(), (error: unknown) => {
    assert.match(
      String(error),
      /OpenAI session revocation could not be confirmed/,
    );
    assert.doesNotMatch(String(error), /private-refresh|private-access/);
    return true;
  });
  assert.equal(fixture.calls.providerRevoked.length, 3);
  assert.deepEqual(fixture.calls.revoked, [connection.id]);
  assert.equal(accounts(fixture.storage).length, 0);
});

test("disconnect reports both provider and server failures after clearing local credentials", async () => {
  const fixture = mount({ providerRevokeFailure: true, revokeFailure: true });
  await fixture.signIn();
  await assert.rejects(fixture.disconnect(), (error: unknown) => {
    assert.match(
      String(error),
      /OpenAI session revocation could not be confirmed/,
    );
    assert.match(String(error), /Server disconnect could not be confirmed/);
    assert.doesNotMatch(String(error), /private-refresh|private-access/);
    return true;
  });
  assert.equal(accounts(fixture.storage).length, 0);
});
test("disconnect revokes the latest rotated refresh token", async () => {
  const fixture = mount();
  await fixture.signIn();
  const [key, value] = accounts(fixture.storage)[0];
  const saved = JSON.parse(value);
  saved.grant.expiresAt = Date.now() + 30000;
  saved.grant.savedAt = Date.now() - 30000;
  fixture.storage.set(key, JSON.stringify(saved));
  await fixture.models();
  await fixture.disconnect();
  assert.deepEqual(fixture.calls.providerRevoked, ["refreshed-refresh"]);
});

test("native Settings presence reports saved permission loss without returning credentials", async () => {
  const fixture = mount();
  assert.equal((await fixture.accountState()).status, "missing");
  await fixture.signIn();
  const [key, value] = accounts(fixture.storage)[0];
  const saved = JSON.parse(value);
  saved.grant.scopes = ["openid", "offline_access"];
  saved.grant.sharingGranted = false;
  fixture.storage.set(key, JSON.stringify(saved));
  const metadata = await fixture.accountState();
  assert.deepEqual(JSON.parse(JSON.stringify(metadata)), {
    status: "saved",
    planUseAllowed: false,
  });
  assert.doesNotMatch(
    JSON.stringify(metadata),
    /private-access|private-refresh|identity-proof|fixture-subject/,
  );
});
test("native Settings can expose an erasable corrupt record without trusting its identity", async () => {
  const fixture = mount();
  await fixture.signIn();
  const [key] = accounts(fixture.storage)[0];
  fixture.storage.set(key, "private-access corrupt");
  assert.equal((await fixture.accountState()).status, "unreadable");
  await fixture.disconnect();
  assert.equal((await fixture.accountState()).status, "missing");
});
test("native Settings presence rejects foreign owners, cancellation and session replacement", async () => {
  const fixture = mount();
  await fixture.signIn();
  await assert.rejects(fixture.accountState(randomUUID()), /account changed/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    fixture.accountState(userId, controller.signal),
    /cancelled/,
  );
  fixture.session.token = "";
  await assert.rejects(fixture.accountState(), /account changed/);
  assert.equal(
    (await mount({ platform: "web" }).accountState()).status,
    "unsupported",
  );
});

test("native Settings rejects a session replaced while its presence read is in flight", async () => {
  const fixture = mount();
  await fixture.signIn();
  const pending = fixture.accountState();
  fixture.session.token = "replacement-session";
  await assert.rejects(pending, /account changed/);
});

test("confirmed unusable native refresh clears tokens and keeps the verified reconnect mapping", async () => {
  const options = {
    refreshError: { status: 400, code: "refresh_token_reused" },
  };
  const fixture = mount(options);
  await fixture.signIn();
  expireSoon(fixture);
  await assert.rejects(fixture.models(), /Reconnect/);
  const json = accounts(fixture.storage)[0][1];
  assert.doesNotMatch(json, /private-access|private-refresh|identity-proof/);
  assert.deepEqual(JSON.parse(json).connection, connection);
  assert.equal(JSON.parse(json).grant, null);
  assert.equal((await fixture.accountState()).status, "reconnect");
  const before = fixture.calls.network;
  await assert.rejects(fixture.models(), /Connect ChatGPT/);
  assert.equal(fixture.calls.network, before);
  await fixture.signIn();
  const url = new URL(fixture.calls.opened.at(-1)!);
  assert.equal(url.searchParams.get("client_id"), connection.client_id);
  assert.equal(url.searchParams.has("id_token_hint"), false);
  assert.ok(JSON.parse(accounts(fixture.storage)[0][1]).grant.accessToken);
});
test("native temporary refresh failure preserves every protected field", async () => {
  const fixture = mount({
    refreshError: { status: 503, code: "temporarily_unavailable" },
  });
  await fixture.signIn();
  const original = expireSoon(fixture);
  await assert.rejects(fixture.models());
  assert.equal(accounts(fixture.storage)[0][1], original);
});
test("confirmed native refresh cannot clear a newer record or another Orbyn session", async () => {
  for (const replacement of ["record", "session"] as const) {
    let fixture: ReturnType<typeof mount>;
    const options = {
      refreshError: { status: 400, code: "invalid_refresh_token" },
      onRefresh: async () => {
        if (replacement === "session")
          fixture.session.token = "replacement-session";
        else {
          const [key, json] = accounts(fixture.storage)[0];
          fixture.storage.set(
            key,
            JSON.stringify({ ...JSON.parse(json), revision: randomUUID() }),
          );
        }
      },
    };
    fixture = mount(options);
    await fixture.signIn();
    expireSoon(fixture);
    await assert.rejects(fixture.models(), /changed/);
    assert.ok(JSON.parse(accounts(fixture.storage)[0][1]).grant.accessToken);
  }
});

test("retired native registration can disconnect owned server metadata without retrying dead tokens", async () => {
  const fixture = mount({
    refreshError: { status: 400, code: "invalid_grant" },
  });
  await fixture.signIn();
  expireSoon(fixture);
  await assert.rejects(fixture.models(), /Reconnect/);
  await assert.rejects(
    fixture.disconnect(),
    /OpenAI session revocation could not be confirmed/,
  );
  assert.equal(accounts(fixture.storage).length, 0);
  assert.equal(fixture.calls.providerRevoked.length, 0);
  assert.deepEqual(fixture.calls.revoked, [connection.id]);
});

test("confirmed unusable refresh closes the existing native executor before another job", async () => {
  const fixture = mount({
    signing: true,
    refreshError: { status: 401, code: "refresh_token_expired" },
  });
  await fixture.signIn();
  const executor = await fixture.executor();
  await executor.start();
  expireSoon(fixture);
  await assert.rejects(fixture.models(), /Reconnect/);
  await assert.rejects(executor.executeNext());
  assert.equal(fixture.calls.responses, 0);
});

test("native disconnect retains a protected token-free issued mapping for reconnect", async () => {
  const fixture = mount();
  await fixture.signIn();
  await fixture.disconnect();
  assert.equal(accounts(fixture.storage).length, 0);
  const entries = [...fixture.storage].filter(([key]) =>
    key.includes(".registration."),
  );
  assert.equal(entries.length, 1);
  assert.deepEqual(JSON.parse(entries[0][1]).connection, connection);
  assert.equal(JSON.parse(entries[0][1]).grant, null);
  assert.doesNotMatch(
    entries[0][1],
    /private-access|private-refresh|identity-proof/,
  );
  assert.equal((await fixture.accountState()).status, "missing");
  await fixture.signIn();
  const url = new URL(fixture.calls.opened.at(-1)!);
  assert.equal(url.searchParams.get("client_id"), connection.client_id);
  assert.equal(url.searchParams.has("id_token_hint"), false);
});

test("native reconnect cannot adopt another Orbyn owner's disconnected mapping", async () => {
  const fixture = mount();
  await fixture.signIn();
  await fixture.disconnect();
  const [key, json] = [...fixture.storage].find(([key]) =>
    key.includes(".registration."),
  )!;
  fixture.storage.delete(key);
  fixture.storage.set("orbyn.chatgpt.registration.foreign-owner", json);
  await fixture.signIn();
  assert.equal(
    new URL(fixture.calls.opened.at(-1)!).searchParams.get("client_id"),
    "dynamic_agent_client",
  );
});

test("native mapping storage failure never prevents credential erasure or server disconnect", async () => {
  const fixture = mount({ failMappingStore: true });
  await fixture.signIn();
  await assert.rejects(fixture.disconnect(), (error: unknown) => {
    assert.match(String(error), /registration could not be saved/);
    assert.doesNotMatch(String(error), /private-access|private-refresh/);
    return true;
  });
  assert.equal(accounts(fixture.storage).length, 0);
  assert.deepEqual(fixture.calls.revoked, [connection.id]);
  assert.deepEqual(fixture.calls.providerRevoked, ["private-refresh"]);
});
test("native reconnect rejects a disconnected mapping replaced during authorization", async () => {
  let fixture: ReturnType<typeof mount>;
  const options: { onFinish?: () => void } = {};
  fixture = mount(options);
  await fixture.signIn();
  await fixture.disconnect();
  const [key, json] = [...fixture.storage].find(([key]) =>
    key.includes(".registration."),
  )!;
  const replacement = JSON.stringify({
    ...JSON.parse(json),
    revision: randomUUID(),
  });
  options.onFinish = () => fixture.storage.set(key, replacement);
  await assert.rejects(fixture.signIn(), /registration changed/);
  assert.equal(accounts(fixture.storage).length, 0);
  assert.equal(fixture.storage.get(key), replacement);
});

const migratedAlias = "e".repeat(64);
function attachMigratedAlias(f: ReturnType<typeof mount>) {
  const [key, raw] = accounts(f.storage)[0];
  f.storage.set(
    key,
    JSON.stringify({ ...JSON.parse(raw), signingAlias: migratedAlias }),
  );
}
test("migrated native credentials use their retained signing key and disconnect removes that key", async () => {
  const f = mount({ signing: true });
  await f.signIn();
  attachMigratedAlias(f);
  const runtime = await f.executor();
  await runtime.start();
  assert.ok(f.signingAliases.length > 0);
  assert.equal(
    f.signingAliases.every((alias) => alias === migratedAlias),
    true,
  );
  await f.disconnect();
  assert.deepEqual(f.removedAliases, [migratedAlias]);
  runtime.close();
});
test("migrated signing alias survives verified token rotation and terminal retirement", async () => {
  for (const terminal of [false, true]) {
    const f = mount(
      terminal
        ? { refreshError: { status: 400, code: "invalid_grant" } }
        : { refreshedId: true },
    );
    await f.signIn();
    attachMigratedAlias(f);
    expireSoon(f);
    if (terminal) await assert.rejects(f.models(), /Reconnect/);
    else await f.models();
    const saved = JSON.parse(accounts(f.storage)[0][1]);
    assert.equal(saved.signingAlias, migratedAlias);
    assert.equal(saved.version, terminal ? 2 : 1);
  }
});
test("migrated alias persists through disconnect mapping and reconnect", async () => {
  const f = mount({ signing: true });
  await f.signIn();
  attachMigratedAlias(f);
  await f.disconnect();
  const mapping = [...f.storage].find(([key]) =>
    key.includes(".registration."),
  )!;
  assert.equal(JSON.parse(mapping[1]).signingAlias, migratedAlias);
  await f.signIn();
  assert.equal(
    JSON.parse(accounts(f.storage)[0][1]).signingAlias,
    migratedAlias,
  );
});
test("invalid signing aliases cannot be used to select a native key", async () => {
  const f = mount({ signing: true });
  await f.signIn();
  const [key, raw] = accounts(f.storage)[0];
  f.storage.set(
    key,
    JSON.stringify({
      ...JSON.parse(raw),
      signingAlias: "private-invalid-alias",
    }),
  );
  await assert.rejects(f.executor(), /saved ChatGPT connection is unavailable/);
  assert.equal(f.signingAliases.length, 0);
});
test("executor rejects a signing alias replaced during its lifetime", async () => {
  const f = mount({ signing: true });
  await f.signIn();
  attachMigratedAlias(f);
  const runtime = await f.executor();
  await runtime.start();
  const [key, raw] = accounts(f.storage)[0];
  f.storage.set(
    key,
    JSON.stringify({ ...JSON.parse(raw), signingAlias: "f".repeat(64) }),
  );
  await assert.rejects(runtime.heartbeat(), /account changed/);
  runtime.close();
});
test("native service migrates its singleton and continues models, signing, disconnect and reconnect in that slot", async () => {
  const f = mount({ signing: true });
  await f.signIn();
  const [oldKey, oldRaw] = accounts(f.storage)[0];
  const before = JSON.parse(oldRaw),
    state = await f.prepare();
  assert.equal(state.selected, connection.id);
  assert.equal(f.storage.has(oldKey), false);
  const [slot, raw] = accounts(f.storage)[0];
  assert.match(slot, /\.slot\./);
  const migrated = JSON.parse(raw);
  assert.deepEqual(migrated.grant, before.grant);
  assert.equal(migrated.signingAlias, oldKey.split(".").at(-1));
  await f.models();
  const runtime = await f.executor();
  await runtime.start();
  assert.equal(
    f.signingAliases.every((alias) => alias === migrated.signingAlias),
    true,
  );
  await f.disconnect();
  assert.equal(f.storage.has(slot), false);
  let directory = JSON.parse(
    [...f.storage].find(([key]) => key.includes(".directory."))![1],
  );
  assert.equal(directory.selected, null);
  assert.equal(directory.accounts[0].status, "disconnected");
  const mapping = [...f.storage].find(([key]) =>
    key.includes(".slot-registration."),
  )!;
  assert.equal(JSON.parse(mapping[1]).signingAlias, migrated.signingAlias);
  await f.signIn();
  directory = JSON.parse(
    [...f.storage].find(([key]) => key.includes(".directory."))![1],
  );
  assert.equal(directory.selected, connection.id);
  assert.equal(directory.accounts[0].status, "connected");
  assert.equal(
    JSON.parse(f.storage.get(slot)!).signingAlias,
    migrated.signingAlias,
  );
  runtime.close();
});
test("native migration preserves terminal reconnect metadata and exact alias", async () => {
  const f = mount({ refreshError: { status: 400, code: "invalid_grant" } });
  await f.signIn();
  attachMigratedAlias(f);
  expireSoon(f);
  await assert.rejects(f.models(), /Reconnect/);
  const state = await f.prepare();
  assert.equal(state.selected, null);
  assert.equal(state.accounts[0].status, "reconnect");
  assert.equal((await f.accountState()).status, "reconnect");
  await f.signIn();
  assert.equal(
    JSON.parse(accounts(f.storage)[0][1]).signingAlias,
    migratedAlias,
  );
});
test("migrated invalid refresh retires exact directory entry without exposing credentials", async () => {
  const f = mount({ refreshError: { status: 400, code: "invalid_grant" } });
  await f.signIn();
  await f.prepare();
  expireSoon(f);
  await assert.rejects(f.models(), /Reconnect/);
  const directory = JSON.parse(
    [...f.storage].find(([key]) => key.includes(".directory."))![1],
  );
  assert.equal(directory.selected, null);
  assert.equal(directory.accounts[0].status, "reconnect");
  assert.equal(JSON.parse(accounts(f.storage)[0][1]).grant, null);
  assert.doesNotMatch(
    JSON.stringify(directory),
    /private-access|private-refresh|private-id/,
  );
});
test("native migration interruption blocks execution until original cleanup resumes", async () => {
  const f = mount({ changeSession: "delete", signing: true });
  await f.signIn();
  await assert.rejects(f.prepare(), /session changed/);
  f.session.token = "orbyn-session";
  await assert.rejects(f.executor(), /Finish migrating/);
  // The deliberate fault repeats on every erase; interrupted cleanup cannot claim success.
  await assert.rejects(f.prepare(), /session changed/);
  assert.equal(
    [...f.storage].filter(([key]) => key.includes(".account.")).length,
    1,
  );
});
test("native migration validates live Orbyn ownership and cancellation before changing credentials", async () => {
  const f = mount();
  await f.signIn();
  const before = [...f.storage];
  await assert.rejects(f.prepare(randomUUID()), /account changed/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(f.prepare(undefined, controller.signal), /cancelled/);
  assert.deepEqual([...f.storage], before);
});
test("migrated disconnected account can repeat exact signing-key cleanup from its token-free mapping", async () => {
  const f = mount({ signing: true });
  await f.signIn();
  attachMigratedAlias(f);
  await f.prepare();
  await f.disconnect();
  await f.disconnect();
  assert.deepEqual(f.removedAliases, [migratedAlias, migratedAlias]);
});
test("session replacement during reconnect directory publication rolls back the new credential slot", async () => {
  let replace = false;
  const f = mount({
    onDirectoryWrite: () => {
      if (replace) f.session.token = "replacement-session";
    },
  });
  await f.signIn();
  await f.prepare();
  await f.disconnect();
  replace = true;
  await assert.rejects(f.signIn(), /directory is unavailable|session changed/);
  assert.equal(accounts(f.storage).length, 0);
  const directory = JSON.parse(
    [...f.storage].find(([key]) => key.includes(".directory."))![1],
  );
  assert.equal(directory.selected, null);
  assert.equal(directory.accounts[0].status, "disconnected");
});
function secondSavedAccount(
  f: ReturnType<typeof mount>,
  target: typeof connection,
) {
  const [key, raw] = accounts(f.storage)[0],
    saved = JSON.parse(raw);
  const slot = key.slice(0, key.lastIndexOf(".") + 1) + target.id;
  const grant = { ...saved.grant, clientId: target.client_id };
  f.storage.set(
    slot,
    JSON.stringify({
      ...saved,
      revision: randomUUID(),
      connection: target,
      grant,
      signingAlias: "b".repeat(64),
    }),
  );
  const [directoryKey, directoryRaw] = [...f.storage].find(([key]) =>
    key.includes(".directory."),
  )!;
  const state = JSON.parse(directoryRaw);
  state.revision = randomUUID();
  state.accounts.push({ connection: target, status: "connected" });
  f.storage.set(directoryKey, JSON.stringify(state));
  return { slot, revision: state.revision };
}
test("native explicit account switch verifies live identity and preserves the previous slot", async () => {
  const target = {
    ...connection,
    id: randomUUID(),
    subject: "other-subject",
    client_id: "oaiapp_other",
  };
  const f = mount({ signing: true, liveConnections: [connection, target] });
  await f.signIn();
  await f.prepare();
  const [oldKey, oldRaw] = accounts(f.storage)[0],
    second = secondSavedAccount(f, target);
  const next = await f.chooseAccount(target.id, second.revision);
  assert.equal(next.selected, target.id);
  assert.equal(f.storage.get(oldKey), oldRaw);
  assert.equal((await f.models()).connection.id, target.id);
  assert.doesNotMatch(
    JSON.stringify(await f.savedAccounts()),
    /private-access|private-refresh|grant|signingAlias/,
  );
});
test("native account switch rejects stale cards, substituted identities and missing grants", async () => {
  const target = {
    ...connection,
    id: randomUUID(),
    subject: "other-subject",
    client_id: "oaiapp_other",
  };
  for (const failure of [
    "revision",
    "identity",
    "missing",
    "revoked",
  ] as const) {
    const f = mount({
      signing: true,
      liveConnections:
        failure === "revoked" ? [connection] : [connection, target],
    });
    await f.signIn();
    await f.prepare();
    const second = secondSavedAccount(f, target);
    if (failure === "missing") f.storage.delete(second.slot);
    if (failure === "identity") {
      const saved = JSON.parse(f.storage.get(second.slot)!);
      saved.connection.subject = "substitution";
      f.storage.set(second.slot, JSON.stringify(saved));
    }
    await assert.rejects(
      f.chooseAccount(
        target.id,
        failure === "revision" ? randomUUID() : second.revision,
      ),
      /selection changed|Reconnect/,
    );
    assert.equal((await f.savedAccounts()).selected, connection.id);
  }
});
test("native switch refreshes an expiring selected grant before changing directory selection", async () => {
  const f = mount({ signing: true });
  await f.signIn();
  await f.prepare();
  expireSoon(f);
  const before = await f.savedAccounts();
  await f.chooseAccount(connection.id, before.revision);
  assert.equal(f.calls.refreshed, 1);
  assert.equal(
    JSON.parse(accounts(f.storage)[0][1]).grant.accessToken,
    "refreshed-access",
  );
});
test("confirmed invalid refresh during switching never activates the retired account", async () => {
  const f = mount({
    signing: true,
    refreshError: { status: 400, code: "invalid_grant" },
  });
  await f.signIn();
  await f.prepare();
  expireSoon(f);
  const before = await f.savedAccounts();
  await assert.rejects(
    f.chooseAccount(connection.id, before.revision),
    /Reconnect/,
  );
  const after = await f.savedAccounts();
  assert.equal(after.selected, null);
  assert.equal(after.accounts[0].status, "reconnect");
});
test("switching has one exclusive cancellable lifetime while a refresh is in flight", async () => {
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => {
      entered = resolve;
    }),
    wait = new Promise<void>((resolve) => {
      release = resolve;
    });
  const f = mount({
    signing: true,
    onRefresh: async () => {
      entered();
      await wait;
    },
  });
  await f.signIn();
  await f.prepare();
  expireSoon(f);
  const before = await f.savedAccounts(),
    controller = new AbortController();
  const switching = f.chooseAccount(
    connection.id,
    before.revision,
    controller.signal,
  );
  const rejected = assert.rejects(
    switching,
    /selection changed|session or ChatGPT|sign-in was cancelled/,
  );
  await started;
  await assert.rejects(f.signIn(), /current ChatGPT action/);
  await assert.rejects(f.prepare(), /current ChatGPT action/);
  controller.abort();
  release();
  await rejected;
  assert.equal((await f.savedAccounts()).revision, before.revision);
});
test("native identity-only selection stops the previous executor without enabling inference", async () => {
  const target = {
    ...connection,
    id: randomUUID(),
    subject: "other-subject",
    client_id: "oaiapp_other",
  };
  const f = mount({ signing: true, liveConnections: [connection, target] });
  await f.signIn();
  await f.prepare();
  const runtime = await f.executor();
  await runtime.start();
  const second = secondSavedAccount(f, target);
  const saved = JSON.parse(f.storage.get(second.slot)!);
  saved.grant.scopes = ["openid"];
  saved.grant.sharingGranted = false;
  f.storage.set(second.slot, JSON.stringify(saved));
  await f.chooseAccount(target.id, second.revision);
  await assert.rejects(runtime.heartbeat());
  assert.equal((await f.savedAccounts()).selected, target.id);
  await assert.rejects(f.executor());
  await assert.rejects(f.models());
  assert.equal(f.calls.responses, 0);
  runtime.close();
});
test("native Add account uses dynamic registration and preserves the existing selected credentials", async () => {
  const target = {
    ...connection,
    id: randomUUID(),
    subject: "second-subject",
    client_id: "oaiapp_second",
  };
  let currentConnection = connection;
  const f = mount({
    signing: true,
    connection: () => currentConnection,
    liveConnections: [connection, target],
  });
  await f.signIn();
  await f.prepare();
  const [oldKey, oldRaw] = accounts(f.storage)[0];
  const before = await f.savedAccounts();
  currentConnection = target;
  await f.signIn(undefined, { kind: "add", expectedRevision: before.revision });
  const after = await f.savedAccounts();
  assert.equal(after.accounts.length, 2);
  assert.equal(after.selected, target.id);
  assert.equal(f.storage.get(oldKey), oldRaw);
  assert.equal(accounts(f.storage).length, 2);
  const url = new URL(f.calls.opened.at(-1)!);
  assert.equal(url.searchParams.get("client_id"), "dynamic_agent_client");
  assert.equal(url.searchParams.has("id_token_hint"), false);
  const newSaved = JSON.parse(
    accounts(f.storage).find(
      ([, raw]) => JSON.parse(raw).connection.id === target.id,
    )![1],
  );
  assert.match(newSaved.signingAlias, /^[a-f0-9]{64}$/);
  assert.notEqual(newSaved.signingAlias, JSON.parse(oldRaw).signingAlias);
});
test("native targeted reconnect reuses the unavailable registration while another account is active", async () => {
  const target = {
    ...connection,
    id: randomUUID(),
    subject: "second-subject",
    client_id: "oaiapp_second",
  };
  let currentConnection = connection;
  const f = mount({
    signing: true,
    connection: () => currentConnection,
    liveConnections: [connection, target],
  });
  await f.signIn();
  await f.prepare();
  const before = await f.savedAccounts();
  currentConnection = target;
  await f.signIn(undefined, { kind: "add", expectedRevision: before.revision });
  const [targetKey, targetRaw] = accounts(f.storage).find(
    ([, raw]) => JSON.parse(raw).connection.id === target.id,
  )!;
  const selected = await f.savedAccounts();
  currentConnection = connection;
  await f.chooseAccount(connection.id, selected.revision);
  const [directoryKey, directoryRaw] = [...f.storage].find(([key]) =>
    key.includes(".directory."),
  )!;
  const directory = JSON.parse(directoryRaw);
  directory.accounts.find(
    (entry: any) => entry.connection.id === target.id,
  ).status = "reconnect";
  directory.revision = randomUUID();
  f.storage.set(directoryKey, JSON.stringify(directory));
  const retired = {
    ...JSON.parse(targetRaw),
    version: 2,
    revision: randomUUID(),
    grant: null,
  };
  f.storage.set(targetKey, JSON.stringify(retired));
  const old = [...accounts(f.storage)].find(
    ([, raw]) => JSON.parse(raw).connection.id === connection.id,
  )!;
  currentConnection = target;
  await f.signIn(undefined, {
    kind: "reconnect",
    connectionId: target.id,
    expectedRevision: directory.revision,
  });
  assert.equal((await f.savedAccounts()).selected, target.id);
  assert.equal(f.storage.get(old[0]), old[1]);
  const url = new URL(f.calls.opened.at(-1)!);
  assert.equal(url.searchParams.get("client_id"), target.client_id);
  assert.equal(url.searchParams.has("id_token_hint"), false);
  assert.equal(
    JSON.parse(f.storage.get(targetKey)!).signingAlias,
    retired.signingAlias,
  );
});
test("native Add rejects a stale revision and duplicate existing registration without overwriting slots", async () => {
  const f = mount({ signing: true });
  await f.signIn();
  await f.prepare();
  const before = await f.savedAccounts(),
    original = [...f.storage];
  const calls = f.calls.started;
  await assert.rejects(
    f.signIn(undefined, { kind: "add", expectedRevision: randomUUID() }),
    /selection changed/,
  );
  assert.equal(f.calls.started, calls);
  await assert.rejects(
    f.signIn(undefined, { kind: "add", expectedRevision: before.revision }),
    /already saved/,
  );
  assert.deepEqual([...f.storage], original);
});
test("native explicit reconnect refuses a mismatched protected registration before opening OAuth", async () => {
  const f = mount({ signing: true });
  await f.signIn();
  await f.prepare();
  const before = await f.savedAccounts();
  const [key, raw] = accounts(f.storage)[0],
    parsed = JSON.parse(raw);
  parsed.connection.subject = "substituted";
  f.storage.set(key, JSON.stringify(parsed));
  const count = f.calls.opened.length;
  await assert.rejects(
    f.signIn(undefined, {
      kind: "reconnect",
      connectionId: connection.id,
      expectedRevision: before.revision,
    }),
    /registration is unavailable/,
  );
  assert.equal(f.calls.opened.length, count);
});
test("disconnecting one of multiple native accounts preserves other slots and a usable unselected picker", async () => {
  const target = {
    ...connection,
    id: randomUUID(),
    subject: "second-subject",
    client_id: "oaiapp_second",
  };
  let currentConnection = connection;
  const f = mount({
    signing: true,
    connection: () => currentConnection,
    liveConnections: [connection, target],
  });
  await f.signIn();
  await f.prepare();
  const [oldKey, oldRaw] = accounts(f.storage)[0],
    before = await f.savedAccounts();
  currentConnection = target;
  await f.signIn(undefined, { kind: "add", expectedRevision: before.revision });
  await f.disconnect();
  assert.equal(f.storage.get(oldKey), oldRaw);
  assert.equal(accounts(f.storage).length, 1);
  assert.equal((await f.accountState()).status, "missing");
  const after = await f.savedAccounts();
  assert.equal(after.accounts.length, 2);
  assert.equal(after.selected, null);
  currentConnection = connection;
  await f.chooseAccount(connection.id, after.revision);
  assert.equal((await f.savedAccounts()).selected, connection.id);
});
test("native Add directory conflict removes only the attempted new slot and preserves a newer selection revision", async () => {
  const target = {
    ...connection,
    id: randomUUID(),
    subject: "second-subject",
    client_id: "oaiapp_second",
  };
  let currentConnection = connection,
    change = false,
    newRevision = "";
  const f = mount({
    connection: () => currentConnection,
    onFinish: () => {
      if (change) {
        const [key, raw] = [...f.storage].find(([key]) =>
          key.includes(".directory."),
        )!;
        const state = JSON.parse(raw);
        state.revision = newRevision = randomUUID();
        f.storage.set(key, JSON.stringify(state));
      }
    },
  });
  await f.signIn();
  await f.prepare();
  const [oldKey, oldRaw] = accounts(f.storage)[0],
    before = await f.savedAccounts();
  currentConnection = target;
  change = true;
  await assert.rejects(
    f.signIn(undefined, { kind: "add", expectedRevision: before.revision }),
    /selection changed/,
  );
  assert.equal(accounts(f.storage).length, 1);
  assert.equal(f.storage.get(oldKey), oldRaw);
  const after = await f.savedAccounts();
  assert.equal(after.revision, newRevision);
  assert.equal(after.selected, connection.id);
});
test("native Add retains declined-plan identity without switching the selected account", async () => {
  const target = {
    ...connection,
    id: randomUUID(),
    subject: "second-subject",
    client_id: "oaiapp_second",
  };
  let currentConnection = connection;
  const options: { connection: () => typeof connection; scopes?: string } = {
    connection: () => currentConnection,
  };
  const f = mount(options);
  await f.signIn();
  await f.prepare();
  const before = await f.savedAccounts(),
    original = [...f.storage];
  currentConnection = target;
  options.scopes = "openid resource.invoke";
  const result = await f.signIn(undefined, {
    kind: "add",
    expectedRevision: before.revision,
  });
  assert.equal(result.sharingGranted, false);
  assert.equal(accounts(f.storage).length, 2);
  for (const [key, value] of original)
    if (key.includes(".slot.")) assert.equal(f.storage.get(key), value);
  assert.equal(f.calls.responses, 0);
  assert.equal((await f.savedAccounts()).selected, connection.id);
});
test("native OAuth action is copied before awaits so caller mutation cannot bypass its displayed revision", async () => {
  const target = {
    ...connection,
    id: randomUUID(),
    subject: "second-subject",
    client_id: "oaiapp_second",
  };
  let currentConnection = connection,
    mutate = false;
  const action = { kind: "add" as const, expectedRevision: "" };
  const f = mount({
    connection: () => currentConnection,
    onFinish: () => {
      if (mutate) {
        const [key, raw] = [...f.storage].find(([key]) =>
          key.includes(".directory."),
        )!;
        const state = JSON.parse(raw);
        state.revision = randomUUID();
        action.expectedRevision = state.revision;
        f.storage.set(key, JSON.stringify(state));
      }
    },
  });
  await f.signIn();
  await f.prepare();
  action.expectedRevision = (await f.savedAccounts()).revision;
  currentConnection = target;
  mutate = true;
  await assert.rejects(f.signIn(undefined, action), /selection changed/);
  assert.equal(accounts(f.storage).length, 1);
  assert.equal((await f.savedAccounts()).selected, connection.id);
});
test("native repeated disconnect retries failed server cleanup after credential erasure", async () => {
  const options = { revokeFailure: true };
  const f = mount(options);
  await f.signIn();
  await assert.rejects(f.disconnect(), /Server disconnect/);
  assert.equal(accounts(f.storage).length, 0);
  options.revokeFailure = false;
  await f.disconnect();
  assert.deepEqual(f.calls.revoked, [connection.id, connection.id]);
  assert.equal(f.calls.providerRevoked.length, 1);
});
test("native signing-key cleanup failure does not skip owned server cleanup", async () => {
  const f = mount({ signing: true, keyRemovalFailure: true });
  await f.signIn();
  await f.prepare();
  await assert.rejects(f.disconnect(), /signing key could not be erased/);
  assert.deepEqual(f.calls.revoked, [connection.id]);
  assert.equal(accounts(f.storage).length, 0);
  await assert.rejects(f.disconnect(), /signing key could not be erased/);
  assert.deepEqual(f.calls.revoked, [connection.id, connection.id]);
});
test("native credential erase failure still attempts key/server cleanup and never claims removal", async () => {
  const options = { signing: true, credentialRemovalFailure: false };
  const f = mount(options);
  await f.signIn();
  await f.prepare();
  options.credentialRemovalFailure = true;
  await assert.rejects(f.disconnect(), (error) => {
    assert.match(String(error), /disconnect is incomplete/);
    assert.doesNotMatch(String(error), /was removed|private-token/);
    return true;
  });
  assert.equal(accounts(f.storage).length, 1);
  assert.equal(f.calls.keyRemoved, 1);
  assert.deepEqual(f.calls.revoked, [connection.id]);
  assert.equal((await f.accountState()).status, "unreadable");
  options.credentialRemovalFailure = false;
  await f.disconnect();
  assert.equal(accounts(f.storage).length, 0);
  assert.equal(f.calls.providerRevoked.length, 1);
});
test("native retry retains unconfirmed OpenAI revocation guidance after local erasure", async () => {
  const f = mount({ providerRevokeFailure: true });
  await f.signIn();
  await assert.rejects(
    f.disconnect(),
    /OpenAI session revocation could not be confirmed/,
  );
  await assert.rejects(
    f.disconnect(),
    /OpenAI session revocation could not be confirmed/,
  );
  assert.equal(f.calls.providerRevoked.length, 3);
  assert.equal(accounts(f.storage).length, 0);
});
test("native missing refresh token does not invent an OpenAI revocation confirmation", async () => {
  const f = mount();
  await f.signIn();
  const [key, raw] = accounts(f.storage)[0],
    saved = JSON.parse(raw);
  saved.grant.refreshToken = null;
  f.storage.set(key, JSON.stringify(saved));
  await assert.rejects(
    f.disconnect(),
    /OpenAI session revocation could not be confirmed/,
  );
  assert.equal(f.calls.providerRevoked.length, 0);
  assert.equal(accounts(f.storage).length, 0);
});
test("native reconnect revision cannot inherit a prior grant revocation confirmation", async () => {
  const f = mount();
  await f.signIn();
  await f.disconnect();
  await f.signIn();
  await f.disconnect();
  assert.equal(f.calls.providerRevoked.length, 2);
});
test("native targeted cleanup removes an inactive account without changing the selected profile or its credentials", async () => {
  const other = {
    ...connection,
    id: randomUUID(),
    subject: "other-subject",
    client_id: "oaiapp_other",
  };
  let currentConnection = connection;
  const f = mount({
    signing: true,
    connection: () => currentConnection,
    liveConnections: [connection, other],
  });
  await f.signIn();
  await f.prepare();
  let before = await f.savedAccounts();
  currentConnection = other;
  await f.signIn(undefined, { kind: "add", expectedRevision: before.revision });
  before = await f.savedAccounts();
  currentConnection = connection;
  await f.chooseAccount(connection.id, before.revision);
  const [selectedKey, selectedRaw] = accounts(f.storage).find(
    ([, raw]) => JSON.parse(raw).connection.id === connection.id,
  )!;
  before = await f.savedAccounts();
  currentConnection = other;
  await f.disconnect(undefined, {
    connectionId: other.id,
    expectedRevision: before.revision,
  });
  assert.equal(f.storage.get(selectedKey), selectedRaw);
  assert.equal((await f.savedAccounts()).selected, connection.id);
  assert.deepEqual(f.calls.revoked, [other.id]);
  const next = await f.savedAccounts();
  await f.disconnect(undefined, {
    connectionId: other.id,
    expectedRevision: next.revision,
  });
  assert.deepEqual(f.calls.revoked, [other.id, other.id]);
});
test("native targeted cleanup rejects a stale menu revision or substituted retired identity before erasure", async () => {
  const f = mount();
  await f.signIn();
  await f.prepare();
  const before = await f.savedAccounts();
  await assert.rejects(
    f.disconnect(undefined, {
      connectionId: connection.id,
      expectedRevision: randomUUID(),
    }),
    /cleanup selection changed/,
  );
  assert.equal(accounts(f.storage).length, 1);
  const [key, raw] = accounts(f.storage)[0],
    saved = JSON.parse(raw);
  saved.version = 2;
  saved.grant = null;
  saved.connection.subject = "substitution";
  f.storage.set(key, JSON.stringify(saved));
  await assert.rejects(
    f.disconnect(undefined, {
      connectionId: connection.id,
      expectedRevision: before.revision,
    }),
    /cleanup identity changed/,
  );
  assert.equal(f.storage.get(key), JSON.stringify(saved));
  assert.equal(f.calls.revoked.length, 0);
});

test("native credential read faults remain unknown and cannot authorize execution or destructive cleanup", async () => {
  let faultKey: string | undefined;
  const f = mount({
    signing: true,
    onStorageRead: (key) => {
      if (key === faultKey)
        throw new Error("private-access private-refresh keychain diagnostics");
    },
  });
  await f.signIn();
  const [key, raw] = accounts(f.storage)[0];
  faultKey = key;
  assert.equal((await f.accountState()).status, "unreadable");
  for (const action of [
    () => f.models(),
    () => f.executor(),
    () => f.disconnect(),
  ]) {
    await assert.rejects(action(), (error: Error) => {
      assert.match(error.message, /storage could not be read/);
      assert.doesNotMatch(
        error.stack ?? "",
        /private-access|private-refresh|keychain diagnostics/,
      );
      assert.equal(error.cause, undefined);
      return true;
    });
  }
  assert.equal(f.storage.get(key), raw);
  assert.deepEqual(f.removedAliases, []);
  assert.deepEqual(f.calls.revoked, []);
  assert.deepEqual(f.calls.providerRevoked, []);
  faultKey = undefined;
  assert.equal((await f.accountState()).status, "saved");
  await f.disconnect();
  assert.equal(accounts(f.storage).length, 0);
});
test("native unreadable reconnect mapping does not become an empty registration or erase credentials", async () => {
  let failMapping = false;
  const f = mount({
    onStorageRead: (key) => {
      if (failMapping && key.includes(".registration."))
        throw new Error("private-refresh mapping diagnostics");
    },
  });
  await f.signIn();
  const [key, raw] = accounts(f.storage)[0];
  failMapping = true;
  await assert.rejects(f.disconnect(), /storage could not be read/);
  await assert.rejects(f.signIn(), /storage could not be read/);
  assert.equal(f.storage.get(key), raw);
  assert.deepEqual(f.calls.revoked, []);
  assert.deepEqual(f.calls.providerRevoked, []);
  failMapping = false;
  await f.disconnect();
  assert.equal(accounts(f.storage).length, 0);
});

test("actual native inference and cancellation work with React Native AbortController", async () => {
  const mobileRequire = createRequire(
    new URL("../../mobile/package.json", import.meta.url),
  );
  const nativeRequire = createRequire(
    mobileRequire.resolve("react-native/package.json"),
  );
  const { AbortController: NativeAbortController } =
    nativeRequire("abort-controller");
  const original = globalThis.AbortController;
  let runtime: any;
  globalThis.AbortController = NativeAbortController;
  try {
    assert.equal(
      typeof new NativeAbortController().signal.throwIfAborted,
      "undefined",
    );
    const f = mount({ signing: true, inference: "success" });
    await f.signIn();
    runtime = await f.executor();
    await runtime.start();
    assert.deepEqual(await runtime.executeNext(), { processed: true });
    assert.equal(f.calls.responses, 1);
    assert.equal(f.calls.publications[0].receipt.result.status, "completed");
    const cancelled = new NativeAbortController();
    cancelled.abort();
    await assert.rejects(runtime.executeNext(cancelled.signal));
    assert.equal(f.calls.responses, 1);
    assert.equal(f.calls.publications.length, 1);
  } finally {
    runtime?.close();
    globalThis.AbortController = original;
  }
});

test("native account switch fences old in-flight inference and binds the replacement to its own credential and catalog", async () => {
  const other = {
    ...connection,
    id: randomUUID(),
    subject: "other-subject",
    client_id: "oaiapp_other",
  };
  let expectedToken = "private-access",
    entered!: () => void,
    release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let firstRequest = true;
  const f = mount({
    signing: true,
    inference: "success",
    liveConnections: [connection, other],
    providerToken: () => expectedToken,
    onResponses: async () => {
      if (firstRequest) {
        firstRequest = false;
        entered();
        await blocked;
      }
    },
  });
  let older: any, replacement: any;
  try {
    await f.signIn();
    await f.prepare();
    const [originalKey, originalRaw] = accounts(f.storage)[0];
    const target = secondSavedAccount(f, other);
    const record = JSON.parse(f.storage.get(target.slot)!);
    record.grant.accessToken = "private-other-access";
    f.storage.set(target.slot, JSON.stringify(record));
    older = await f.executor();
    const oldStart = await older.start();
    const work = older.executeNext();
    const interrupted = assert.rejects(work);
    await started;
    await f.chooseAccount(other.id, target.revision);
    expectedToken = "private-other-access";
    await interrupted;
    await assert.rejects(older.heartbeat());
    assert.equal(f.calls.publications.length, 0);
    assert.equal(f.storage.get(originalKey), originalRaw);
    const before = f.calls.responses;
    await assert.rejects(older.executeNext());
    assert.equal(f.calls.responses, before);
    replacement = await f.executor();
    const newStart = await replacement.start();
    assert.equal(newStart.selection.connection_id, other.id);
    assert.notEqual(
      newStart.selection.executor_id,
      oldStart.selection.executor_id,
    );
    const catalog: any = f.calls.catalogs.at(-1);
    assert.equal(catalog.binding.connection_id, other.id);
    assert.equal(catalog.binding.subject, other.subject);
    assert.equal(catalog.binding.client_id, other.client_id);
    assert.equal(f.calls.modelTokens.at(-1), "Bearer private-other-access");
    assert.deepEqual(await replacement.executeNext(), { processed: true });
    assert.equal(f.calls.publications.length, 1);
    const receipt = f.calls.publications[0].receipt;
    assert.equal(receipt.binding.connection_id, other.id);
    assert.equal(receipt.executor_id, newStart.selection.executor_id);
    assert.deepEqual(f.calls.responseTokens, [
      "Bearer private-access",
      "Bearer private-other-access",
    ]);
    release();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(
      f.calls.publications.length,
      1,
      "late old response cannot publish into the new profile",
    );
    assert.equal(f.storage.get(originalKey), originalRaw);
    assert.deepEqual(
      f.removedAliases,
      [],
      "switching preserves both accounts' signing keys",
    );
  } finally {
    release();
    older?.close();
    replacement?.close();
  }
});

test("identity-only sign-in is retained without publishing an executable provider", async () => {
  const f = mount({ scopes: "openid offline_access" });
  const result = await f.signIn();
  assert.equal(result.sharingGranted, false);
  assert.equal(
    JSON.parse(accounts(f.storage)[0][1]).grant.sharingGranted,
    false,
  );
  await assert.rejects(f.models());
  assert.equal(f.calls.responses, 0);
});

test("provider rotation followed by backend or replacement-storage failure never retries consumed R1", async () => {
  for (const failStorage of [false, true]) {
    const f = mount({
      consumeRefresh: true,
      refreshedId: true,
      failRefreshProof: !failStorage,
      failRotatedStore: failStorage,
    });
    await f.signIn();
    expireSoon(f);
    await assert.rejects(f.models());
    assert.equal(JSON.parse(accounts(f.storage)[0][1]).grant, null);
    await assert.rejects(f.models());
    assert.equal(f.calls.refreshed, 1);
  }
});

test("native explicit plan enablement reuses the identity-only issued registration and preserves declined state", async () => {
  const f = mount({ scopes: "openid offline_access" });
  await f.signIn();
  await f.prepare();
  const before = await f.savedAccounts();
  const result = await f.signIn(undefined, {
    kind: "reconnect",
    connectionId: connection.id,
    expectedRevision: before.revision,
    requestPlanConsent: true,
  });
  assert.equal(result.sharingGranted, false);
  const url = new URL(f.calls.opened.at(-1)!);
  assert.equal(url.searchParams.get("client_id"), connection.client_id);
  assert.equal(url.searchParams.get("prompt"), "consent");
  await assert.rejects(f.models());
  assert.equal(f.calls.responses, 0);
});

test("explicit native consent can enable the retained identity account without creating a new registration", async () => {
  const options: { scopes?: string } = { scopes: "openid offline_access" };
  const f = mount(options);
  await f.signIn();
  await f.prepare();
  const before = await f.savedAccounts();
  options.scopes = tokens.scope;
  const result = await f.signIn(undefined, {
    kind: "reconnect",
    connectionId: connection.id,
    expectedRevision: before.revision,
    requestPlanConsent: true,
  });
  assert.equal(result.sharingGranted, true);
  assert.equal(result.connection.id, connection.id);
  assert.equal(accounts(f.storage).length, 1);
  await f.models();
  assert.equal(
    new URL(f.calls.opened.at(-1)!).searchParams.get("prompt"),
    "consent",
  );
});
