const { createServer } = require("node:http");
const { randomBytes, createHash, timingSafeEqual } = require("node:crypto");

const CALLBACK = "/auth/callback";
const RESOURCE = "https://api.openai.com/v1";
const SCOPES =
  "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const identifier = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 512 &&
  !/[\s\x00-\x1f\x7f]/.test(value);
const issuedClient = (value) =>
  identifier(value) && value !== "dynamic_agent_client";
const same = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
class AuthError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
const failure = (code, message) => new AuthError(code, message);

/** Main-process OAuth attempt. Its result contains secrets and must never cross IPC. */
async function prepareChatgptAuthorization(options = {}) {
  const {
    hostId,
    nonce,
    clientId,
    idTokenHint,
    signal,
    timeoutMs = 600_000,
  } = options ?? {};
  if (
    !identifier(hostId) ||
    (clientId !== undefined && !issuedClient(clientId)) ||
    (idTokenHint !== undefined &&
      (clientId === undefined ||
        typeof idTokenHint !== "string" ||
        !idTokenHint ||
        idTokenHint.length > 65_536 ||
        /[\x00-\x20\x7f]/.test(idTokenHint))) ||
    (nonce !== undefined &&
      (!identifier(nonce) || nonce.length < 16 || nonce.length > 256)) ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 600_000
  )
    throw failure("AUTH_INPUT", "Invalid ChatGPT sign-in configuration.");
  if (signal?.aborted)
    throw failure("AUTH_ABORTED", "ChatGPT sign-in was cancelled.");
  const state = randomBytes(32).toString("base64url");
  const expectedNonce = nonce ?? randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  let resolve,
    reject,
    finished = false,
    timer,
    redirectUri;
  const result = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  // A user may cancel before the caller installs its handler. Still reject the
  // original promise, but never generate a global unhandled rejection.
  void result.catch(() => {});
  const respond = (res, status, message) => {
    res.writeHead(status, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      ...(status === 405 ? { Allow: "GET" } : {}),
    });
    res.end(message);
  };
  const finish = (error, value, force = false) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
    server.close();
    if (force) server.closeAllConnections();
    if (error) reject(error);
    else resolve(value);
  };
  const cancel = () =>
    finish(
      failure("AUTH_ABORTED", "ChatGPT sign-in was cancelled."),
      undefined,
      true,
    );
  const server = createServer(
    { connectionsCheckingInterval: 1000 },
    (req, res) => {
      if (finished) return respond(res, 409, "This sign-in attempt has ended.");
      // A host check also prevents DNS rebinding onto this loopback listener.
      if (
        req.headers.host !== new URL(redirectUri).host ||
        req.headers.origin ||
        req.socket.remoteAddress !== "127.0.0.1"
      )
        return respond(res, 403, "This callback is not allowed.");
      if (req.method !== "GET")
        return respond(res, 405, "Use the sign-in callback.");
      if (!req.url || req.url.length > 8192 || !req.url.startsWith("/"))
        return respond(res, 400, "Invalid sign-in callback.");
      let url;
      try {
        url = new URL(req.url, redirectUri);
      } catch {
        return respond(res, 400, "Invalid sign-in callback.");
      }
      if (
        url.origin !== new URL(redirectUri).origin ||
        url.pathname !== CALLBACK ||
        url.hash
      )
        return respond(res, 404, "This callback is not available.");
      const keys = new Set();
      for (const key of url.searchParams.keys()) {
        if (keys.has(key))
          return respond(res, 400, "Invalid sign-in callback.");
        keys.add(key);
      }
      if (!same(url.searchParams.get("state"), state))
        return respond(
          res,
          400,
          "This callback does not match the sign-in attempt.",
        );
      const providerError = url.searchParams.get("error");
      if (providerError !== null) {
        respond(
          res,
          400,
          "ChatGPT sign-in did not complete. Return to Orbyn to try again.",
        );
        return finish(
          failure(
            providerError === "access_denied" ? "AUTH_DENIED" : "AUTH_FAILED",
            "ChatGPT sign-in did not complete.",
          ),
        );
      }
      const issued = url.searchParams.get("client_id") ?? clientId;
      const code = url.searchParams.get("code");
      if (
        !issuedClient(issued) ||
        (clientId !== undefined && issued !== clientId) ||
        typeof code !== "string" ||
        !code ||
        code.length > 4096 ||
        /[\x00-\x20\x7f]/.test(code)
      ) {
        respond(
          res,
          400,
          "ChatGPT registration did not complete. Return to Orbyn to try again.",
        );
        return finish(
          failure(
            "AUTH_REGISTRATION",
            "ChatGPT registration did not complete.",
          ),
        );
      }
      respond(res, 200, "Sign-in received. You can return to Orbyn.");
      finish(null, {
        clientId: issued,
        code,
        nonce: expectedNonce,
        verifier,
        redirectUri,
        // Only token-response scopes may authorize plan usage. Callback scope is ignored.
      });
    },
  );
  server.maxConnections = 8;
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.keepAliveTimeout = 1000;
  await new Promise((yes, no) => {
    server.once("error", no);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", no);
      yes();
    });
  }).catch(() => {
    throw failure(
      "AUTH_LISTENER",
      "Could not start the ChatGPT sign-in callback.",
    );
  });
  redirectUri = `http://127.0.0.1:${server.address().port}${CALLBACK}`;
  server.on("error", () =>
    finish(failure("AUTH_LISTENER", "ChatGPT sign-in callback stopped.")),
  );
  timer = setTimeout(
    () =>
      finish(
        failure("AUTH_EXPIRED", "ChatGPT sign-in expired. Try again."),
        undefined,
        true,
      ),
    timeoutMs,
  );
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
  const authorization = new URL(
    "https://auth.openai.com/api/accounts/authorize",
  );
  for (const [key, value] of Object.entries({
    client_id: clientId ?? "dynamic_agent_client",
    ext_agent_host_id: hostId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: SCOPES,
    resource: RESOURCE,
    state,
    nonce: expectedNonce,
    code_challenge_method: "S256",
    code_challenge: challenge,
    ...(clientId === undefined ? { agent_name_hint: "Orbyn" } : {}),
    ...(idTokenHint === undefined ? {} : { id_token_hint: idTokenHint }),
  }))
    authorization.searchParams.set(key, value);
  return { authorizationUrl: authorization.href, redirectUri, result, cancel };
}

/** Exchange only a completed main-process attempt; provider details never reach UI errors. */
async function exchangeChatgptCode(
  attempt,
  { fetch: fetcher = fetch, signal, timeoutMs = 30_000 } = {},
) {
  if (!attempt || typeof attempt !== "object")
    throw failure("AUTH_INPUT", "Invalid ChatGPT code exchange.");
  let redirect;
  try {
    redirect = new URL(attempt.redirectUri);
  } catch {}
  if (
    !issuedClient(attempt.clientId) ||
    !redirect ||
    redirect.protocol !== "http:" ||
    redirect.hostname !== "127.0.0.1" ||
    !redirect.port ||
    redirect.pathname !== CALLBACK ||
    redirect.search ||
    redirect.hash ||
    redirect.username ||
    redirect.password ||
    typeof attempt.verifier !== "string" ||
    !/^[A-Za-z0-9._~-]{43,128}$/.test(attempt.verifier) ||
    typeof attempt.code !== "string" ||
    !attempt.code ||
    attempt.code.length > 4096 ||
    /[\x00-\x20\x7f]/.test(attempt.code) ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 30_000
  )
    throw failure("AUTH_INPUT", "Invalid ChatGPT code exchange.");
  return requestTokens(
    new URLSearchParams({
      grant_type: "authorization_code",
      client_id: attempt.clientId,
      code: attempt.code,
      code_verifier: attempt.verifier,
      redirect_uri: attempt.redirectUri,
      resource: RESOURCE,
    }),
    { fetch: fetcher, signal, timeoutMs },
    attempt.clientId,
  );
}

/** Refresh one saved registration; no code, redirect, secret or new scope is sent. */
async function refreshChatgptTokens(saved, options = {}) {
  const token = (value) =>
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 65_536 &&
    !/[\x00-\x20\x7f]/.test(value);
  if (
    !saved ||
    !issuedClient(saved.clientId) ||
    !token(saved.refreshToken) ||
    !token(saved.idToken) ||
    !Array.isArray(saved.scopes) ||
    saved.scopes.length > 100 ||
    saved.scopes.some(
      (scope) =>
        typeof scope !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(scope),
    )
  )
    throw failure("AUTH_INPUT", "Invalid ChatGPT refresh request.");
  return requestTokens(
    new URLSearchParams({
      grant_type: "refresh_token",
      client_id: saved.clientId,
      refresh_token: saved.refreshToken,
      resource: RESOURCE,
    }),
    options,
    saved.clientId,
    saved,
  );
}

/** Stop one renewable session; false means remote revocation was not confirmed. */
async function revokeChatgptTokens(
  saved,
  { fetch: fetcher = fetch, signal, timeoutMs = 10_000 } = {},
) {
  if (
    !saved ||
    !issuedClient(saved.clientId) ||
    typeof saved.refreshToken !== "string" ||
    !saved.refreshToken ||
    saved.refreshToken.length > 65_536 ||
    /[\x00-\x20\x7f]/.test(saved.refreshToken) ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 30_000
  )
    throw failure("AUTH_INPUT", "Invalid ChatGPT revocation request.");
  const combined = AbortSignal.any([
    AbortSignal.timeout(timeoutMs),
    ...(signal ? [signal] : []),
  ]);
  try {
    const discovery = await fetcher(
      "https://auth.openai.com/.well-known/openid-configuration",
      {
        method: "GET",
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
        signal: combined,
        headers: { Accept: "application/json" },
      },
    );
    if (!discovery.ok || !discovery.body) return { revoked: false };
    const reader = discovery.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 262_144) {
          await reader.cancel();
          return { revoked: false };
        }
        chunks.push(Buffer.from(value));
      }
    } finally {
      reader.releaseLock();
    }
    combined.throwIfAborted();
    const config = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const endpoint = new URL(config.revocation_endpoint);
    if (
      config.issuer !== "https://auth.openai.com" ||
      endpoint.origin !== "https://auth.openai.com" ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash
    )
      return { revoked: false };
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetcher(endpoint.href, {
          method: "POST",
          redirect: "error",
          credentials: "omit",
          cache: "no-store",
          signal: combined,
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            token: saved.refreshToken,
            token_type_hint: "refresh_token",
            client_id: saved.clientId,
          }),
        });
        await response.body?.cancel();
        combined.throwIfAborted();
        if (response.status === 200) return { revoked: true };
        if (response.status < 500) return { revoked: false };
      } catch {
        if (combined.aborted) return { revoked: false };
      }
      if (attempt === 0)
        await new Promise((resolve) => {
          const finish = () => {
            clearTimeout(timer);
            combined.removeEventListener("abort", finish);
            resolve();
          };
          const timer = setTimeout(finish, 250);
          combined.addEventListener("abort", finish, { once: true });
          if (combined.aborted) finish();
        });
      combined.throwIfAborted();
    }
  } catch {
    /* Do not expose discovery, transport or provider response details. */
  }
  return { revoked: false };
}

async function requestTokens(
  form,
  { fetch: fetcher = fetch, signal, timeoutMs = 30_000 } = {},
  clientId,
  saved,
) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000)
    throw failure("AUTH_INPUT", "Invalid ChatGPT token request.");
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(abort, timeoutMs);
  try {
    if (controller.signal.aborted)
      throw failure("AUTH_ABORTED", "ChatGPT sign-in was cancelled.");
    const response = await fetcher(
      "https://auth.openai.com/api/accounts/oauth/token",
      {
        method: "POST",
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: form,
      },
    );
    if (controller.signal.aborted) {
      await response.body?.cancel();
      throw failure("AUTH_ABORTED", "ChatGPT sign-in stopped. Try again.");
    }
    if (!response.body)
      throw failure("AUTH_RESPONSE", "ChatGPT sign-in could not be completed.");
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 262_144) {
          await reader.cancel();
          throw failure(
            "AUTH_RESPONSE",
            "ChatGPT sign-in could not be completed.",
          );
        }
        chunks.push(Buffer.from(value));
      }
    } finally {
      reader.releaseLock();
    }
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw failure("AUTH_RESPONSE", "ChatGPT sign-in could not be completed.");
    }
    if (!response.ok)
      throw failure(
        body?.error === "invalid_grant"
          ? saved
            ? "AUTH_REFRESH_EXPIRED"
            : "AUTH_CODE_EXPIRED"
          : "AUTH_FAILED",
        "ChatGPT sign-in could not be completed. Try again.",
      );
    const token = (value) =>
      typeof value === "string" &&
      value.length > 0 &&
      value.length <= 65_536 &&
      !/[\x00-\x20\x7f]/.test(value);
    if (
      !body ||
      typeof body !== "object" ||
      !token(body.access_token) ||
      (!saved && !token(body.id_token)) ||
      (body.id_token !== undefined && !token(body.id_token)) ||
      (body.refresh_token !== undefined && !token(body.refresh_token)) ||
      typeof body.token_type !== "string" ||
      body.token_type.toLowerCase() !== "bearer" ||
      !Number.isSafeInteger(body.expires_in) ||
      body.expires_in <= 0 ||
      body.expires_in > 315_360_000 ||
      (!saved && typeof body.scope !== "string") ||
      (body.scope !== undefined &&
        (typeof body.scope !== "string" ||
          body.scope.length > 4096 ||
          /[\x00-\x1f\x7f]/.test(body.scope)))
    )
      throw failure("AUTH_RESPONSE", "ChatGPT sign-in could not be completed.");
    const scopes =
      body.scope === undefined
        ? [...saved.scopes]
        : [...new Set(body.scope.trim().split(/ +/).filter(Boolean))];
    if (controller.signal.aborted)
      throw failure("AUTH_ABORTED", "ChatGPT sign-in stopped. Try again.");
    const savedAt = Date.now();
    return {
      clientId,
      idToken: body.id_token ?? saved?.idToken,
      accessToken: body.access_token,
      refreshToken: body.refresh_token ?? saved?.refreshToken ?? null,
      tokenType: "Bearer",
      scopes,
      savedAt,
      expiresAt: savedAt + body.expires_in * 1000,
      // A caller must still verify ID-token signature/issuer/audience/nonce and
      // the selected account before storing or enabling any of these credentials.
      sharingGranted: scopes.includes("chatgpt.tokens.use.direct"),
    };
  } catch (error) {
    if (controller.signal.aborted)
      throw failure("AUTH_ABORTED", "ChatGPT sign-in stopped. Try again.");
    if (error instanceof AuthError) throw error;
    throw failure(
      "AUTH_FAILED",
      "ChatGPT sign-in could not be completed. Try again.",
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

module.exports = {
  prepareChatgptAuthorization,
  exchangeChatgptCode,
  refreshChatgptTokens,
  revokeChatgptTokens,
};
