import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import {
  readTeamsQuestionReply,
  teamsQuestionInvokeAck,
} from "../src/modules/agent-channels/teams-question-reply.js";
const pair = await generateKeyPair("RS256");
const key = {
  ...(await exportJWK(pair.publicKey)),
  kid: "question",
  endorsements: ["msteams"],
};
const appId = randomUUID(),
  tenantId = randomUUID(),
  objectId = randomUUID();
const activity = () => ({
  type: "invoke",
  name: "adaptiveCard/action",
  id: randomUUID(),
  timestamp: new Date().toISOString(),
  channelId: "msteams",
  serviceUrl: "https://smba.trafficmanager.net/teams/",
  from: { id: "29:owned-human", aadObjectId: objectId },
  recipient: { id: `28:${appId}` },
  conversation: {
    id: "personal-question-chat",
    conversationType: "personal",
    tenantId,
  },
  channelData: { tenant: { id: tenantId } },
  value: {
    trigger: "manual",
    action: {
      type: "Action.Execute",
      verb: "orbyn.answer-question",
      data: {
        delivery_id: randomUUID(),
        waiting_id: randomUUID(),
        question_digest: "a".repeat(64),
        card_nonce: "x".repeat(43),
        choice: 0,
      },
    },
  },
});
async function read(payload: any, audience = appId) {
  const token = await new SignJWT({
    serviceUrl: "https://smba.trafficmanager.net/teams/",
  })
    .setProtectedHeader({ alg: "RS256", kid: "question" })
    .setIssuer("https://api.botframework.com")
    .setAudience(audience)
    .setNotBefore(Math.floor(Date.now() / 1000) - 1)
    .setExpirationTime(Math.floor(Date.now() / 1000) + 600)
    .sign(pair.privateKey);
  return readTeamsQuestionReply(
    Buffer.from(JSON.stringify(payload)),
    { authorization: `Bearer ${token}`, "content-type": "application/json" },
    { appId },
    async () => [key],
  );
}
test("Teams manual Execute binds signed personal actor, tenant, conversation, exact question and transient card proof", async () => {
  const a = activity(),
    r = await read(a);
  assert.equal(r?.choice, 0);
  assert.equal(r?.tenantId, tenantId);
  assert.equal(r?.objectId, objectId);
  assert.equal(r?.waitingId, a.value.action.data.waiting_id);
  assert.equal(r?.cardNonce, a.value.action.data.card_nonce);
  assert.match(r?.requestDigest ?? "", /^[a-f0-9]{64}$/);
});
test("Teams automatic card refresh and unrelated invokes never normalize an answer", async () => {
  const a = activity();
  assert.equal(
    await read({ ...a, value: { ...a.value, trigger: "automatic" } }),
    null,
  );
  assert.equal(await read({ ...a, name: "unrelated/action" }), null);
  assert.equal(
    await read({
      ...a,
      value: {
        ...a.value,
        action: { ...a.value.action, verb: "orbyn.approve" },
      },
    }),
    null,
  );
});
test("Teams wrong audience refuses before a malformed activity can be parsed", async () => {
  await assert.rejects(
    read({ bad: "payload" }, randomUUID()),
    (e: any) => e.status === 401,
  );
});
test("Teams group card and bot actor cannot normalize a personal reply", async () => {
  const a = activity();
  await assert.rejects(
    read({
      ...a,
      conversation: { ...a.conversation, conversationType: "groupChat" },
    }),
    (e: any) => e.status === 400,
  );
  await assert.rejects(
    read({ ...a, from: { ...a.from, id: `28:${appId}` } }),
    (e: any) => e.status === 400,
  );
});
test("Teams conflicting tenant fields cannot select another recipient", async () => {
  const a = activity();
  await assert.rejects(
    read({ ...a, conversation: { ...a.conversation, tenantId: randomUUID() } }),
    (e: any) => e.status === 403,
  );
});
test("Teams question submissions require exactly one bounded answer and reject standing approval fields", async () => {
  const a = activity();
  for (const extra of [
    { answer: "also present" },
    { choice: 5 },
    { choice: undefined },
    { approved: true },
    { card_nonce: "short" },
  ])
    await assert.rejects(
      read({
        ...a,
        value: {
          ...a.value,
          action: {
            ...a.value.action,
            data: { ...a.value.action.data, ...extra },
          },
        },
      }),
      (e: any) => e.status === 400,
    );
});
test("Teams text answers normalize whitespace and remain bounded", async () => {
  const a = activity();
  const r = await read({
    ...a,
    value: {
      ...a.value,
      action: {
        ...a.value.action,
        data: {
          ...a.value.action.data,
          choice: undefined,
          answer: "  My answer  ",
        },
      },
    },
  });
  assert.equal(r?.answer, "My answer");
  assert.equal(r?.choice, undefined);
  await assert.rejects(
    read({
      ...a,
      value: {
        ...a.value,
        action: {
          ...a.value.action,
          data: {
            ...a.value.action.data,
            choice: undefined,
            answer: "x".repeat(4001),
          },
        },
      },
    }),
    (e: any) => e.status === 400,
  );
});
test("Teams very old or future activities cannot acquire pending question authority", async () => {
  for (const offset of [-960000, 360000])
    await assert.rejects(
      read({
        ...activity(),
        timestamp: new Date(Date.now() + offset).toISOString(),
      }),
      (e: any) => e.status === 400,
    );
});
test("Teams retry metadata does not change canonical reply digest; changed answer does", async () => {
  const a = activity(),
    first = await read(a);
  assert.equal(
    (
      await read({
        ...a,
        localTimestamp: new Date().toISOString(),
        locale: "en-US",
      })
    )?.requestDigest,
    first?.requestDigest,
  );
  assert.notEqual(
    (
      await read({
        ...a,
        value: {
          ...a.value,
          action: {
            ...a.value.action,
            data: { ...a.value.action.data, choice: 1 },
          },
        },
      })
    )?.requestDigest,
    first?.requestDigest,
  );
});
test("Teams invoke acknowledgements distinguish queued capture from a stale-card refusal", () => {
  assert.equal(teamsQuestionInvokeAck(true).statusCode, 200);
  assert.doesNotMatch(
    JSON.stringify(teamsQuestionInvokeAck(true)),
    /approved|applied/i,
  );
  assert.equal(teamsQuestionInvokeAck(false).statusCode, 400);
  assert.equal(
    teamsQuestionInvokeAck(false).type,
    "application/vnd.microsoft.error",
  );
});

test("Teams legacy Submit carries the same bounded personal proof without normalizing unrelated text", async () => {
  const a = activity(),
    fallback = {
      ...a,
      type: "message",
      name: undefined,
      value: { ...a.value.action.data, orbyn_action: "orbyn.answer-question" },
    };
  const reply = await read(fallback);
  assert.equal(reply?.choice, 0);
  assert.equal(reply?.waitingId, a.value.action.data.waiting_id);
  assert.equal(
    await read({
      ...fallback,
      value: { ...fallback.value, orbyn_action: "unrelated" },
      text: "Hello",
    }),
    null,
  );
  await assert.rejects(
    read({ ...fallback, value: { ...fallback.value, approved: true } }),
    (e: any) => e.status === 400,
  );
});
