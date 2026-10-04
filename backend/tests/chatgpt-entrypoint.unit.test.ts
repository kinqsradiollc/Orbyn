import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAppLink } from "@orbyn/core";
import {
  deepLinkOfUrl,
  deepLinkPath,
} from "../../desktop/src/app/deep-link.js";
test("ChatGPT sign-in links open settings without carrying credentials or starting consent", () => {
  assert.deepEqual(parseAppLink("orbyn://chatgpt"), { kind: "chatgpt" });
  assert.deepEqual(deepLinkOfUrl("orbyn://chatgpt"), { kind: "chatgpt" });
  assert.equal(deepLinkPath({ kind: "chatgpt" }), "/app/chatgpt");
  for (const link of [
    "orbyn://chatgpt?access_token=forbidden",
    "orbyn://chatgpt/account",
    "orbyn://chatgpt#code",
  ])
    assert.equal(parseAppLink(link), null);
});

test("one-click handoff carries only an opaque request id and preserves it across app sign-in", () => {
  const id = "10998f5e-5f7a-4c48-8d10-9d31b7e654fe";
  assert.deepEqual(parseAppLink(`orbyn://chatgpt?request=${id}`), {
    kind: "chatgpt",
    requestId: id,
  });
  assert.deepEqual(deepLinkOfUrl(`orbyn://chatgpt?request=${id}`), {
    kind: "chatgpt",
    requestId: id,
  });
  assert.equal(
    deepLinkPath({ kind: "chatgpt", requestId: id }),
    `/app/chatgpt?request=${id}`,
  );
  assert.equal(
    parseAppLink(`orbyn://chatgpt?request=${id}&request=${id}`),
    null,
  );
  assert.equal(
    parseAppLink(`orbyn://chatgpt?request=${id}&code=forbidden`),
    null,
  );
});
