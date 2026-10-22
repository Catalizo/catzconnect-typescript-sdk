// Message status, hosted OTP, management API, idempotency, WhatsApp/tracking
// payloads, push device registry and webhook events. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import sodium from "libsodium-wrappers-sumo";
import {
  catzconnect,
  buildSendPayload,
  buildOtpStartPayload,
  buildOtpVerifyPayload,
  buildListMessagesPayload,
  buildRegisterDevicePayload,
  buildPushTopicChangePayload,
  CatzApiError,
  ErrorCodes,
  isRetryableCode,
  parseWebhookEvent,
  WEBHOOK_EVENTS,
} from "../dist/index.mjs";

await sodium.ready;
const b64 = (u) => Buffer.from(u).toString("base64");
const client = sodium.crypto_box_keypair();
const server = sodium.crypto_box_keypair();
const env = { api_key: "live_test", private_key: b64(client.privateKey), server_public_key: b64(server.publicKey) };
function key() {
  const shared = sodium.crypto_scalarmult(server.privateKey, client.publicKey);
  const master = sodium.crypto_generichash(32, shared, null);
  return sodium.crypto_generichash(32, new Uint8Array([...master, ...sodium.from_string("CONNECT-@-2026-HS-@-CATZ")]), null);
}
function serverOpen(body) {
  const plain = sodium.crypto_aead_chacha20poly1305_ietf_decrypt(null, Buffer.from(body.ciphertext, "base64"), null, Buffer.from(body.nonce, "base64"), key());
  return JSON.parse(sodium.to_string(plain));
}
let calls = [];
function mockFetch(status, json, { encrypted = true } = {}) {
  calls = [];
  globalThis.fetch = async (url, init) => {
    const raw = JSON.parse(init.body);
    calls.push({ url, init, body: encrypted ? serverOpen(raw) : raw });
    const text = JSON.stringify(json);
    return { ok: status >= 200 && status < 300, status, text: async () => text, json: async () => JSON.parse(text) };
  };
}
process.env.CATZCONNECT_BASE_URL = "https://api.test/";
const ID = "6f0c1b9e-1111-4222-8333-944455556666";

test("send: idempotency key goes in the header and the body; reference too", async () => {
  mockFetch(200, { success: true, message: "Success", data: { message_id: ID, status: "Queued", test: true } });
  const res = await catzconnect.send({ channel: "Email", type: "Transactional", template: "Custom", identity: "hello",
    payload: { to: "a@b.co", subject: "Hi", body: "<p>x</p>", tracking: { opens: false } }, idempotencyKey: "order-42", reference: "order 42" }, env);
  assert.equal(res.data.message_id, ID);
  assert.equal(calls[0].init.headers["Idempotency-Key"], "order-42");
  assert.equal(calls[0].body.idempotency_key, "order-42");
  assert.equal(calls[0].body.reference, "order 42");
  assert.deepEqual(calls[0].body.tracking, { opens: false });
});

test("send without the new options posts the same body as before", () => {
  const p = buildSendPayload({ channel: "Email", type: "Transactional", template: "Custom", identity: "hello", payload: { to: "a@b.co", subject: "s", body: "b" } });
  assert.deepEqual(Object.keys(p).sort(), ["body", "channel", "identity", "message_type", "subject", "template", "to"]);
});

test("send checks idempotency keys, references and tracking", async () => {
  const base = { channel: "Email", type: "Transactional", template: "Custom", identity: "h", payload: { to: "a@b.co", subject: "s", body: "b" } };
  assert.throws(() => buildSendPayload({ ...base, idempotencyKey: "has space" }), /idempotencyKey/);
  assert.throws(() => buildSendPayload({ ...base, reference: "a\nb" }), /reference/);
  await assert.rejects(catzconnect.send({ ...base, channel: "SMS", payload: { to: "+15550100", body: "x", tracking: { opens: true } } }, env), /tracking/);
});

test("WhatsApp approved templates and media messages are accepted and checked", async () => {
  mockFetch(200, { success: true, message: "Success", data: { message_id: ID, status: "Queued" } });
  await catzconnect.send({ channel: "WhatsApp", type: "Transactional", template: "order_update", identity: "919578456444",
    payload: { to: "+919876543210", whatsapp: { language: "en_US", header: { type: "text", text: "#1234" }, body: ["Ravi", "#1234"],
      buttons: [{ index: 0, type: "url", text: "abc" }, { index: 1, type: "quick_reply", payload: "STOP" }] } } }, env);
  assert.equal(calls[0].body.template, "order_update");
  assert.deepEqual(calls[0].body.whatsapp.body, ["Ravi", "#1234"]);

  mockFetch(200, { success: true, message: "Success", data: { message_id: ID } });
  await catzconnect.send({ channel: "WhatsApp", type: "Notification", template: "Custom", identity: "919578456444",
    payload: { to: "+919876543210", body: "Invoice", whatsapp: { media: { type: "document", link: "https://x.example/i.pdf", filename: "i.pdf" } } } }, env);
  assert.equal(calls[0].body.whatsapp.media.type, "document");

  await assert.rejects(catzconnect.send({ channel: "WhatsApp", type: "Transactional", template: "Order Update", identity: "919578456444", payload: { to: "+919876543210", whatsapp: {} } }, env), /lower-case/);
  await assert.rejects(async () => catzconnect.send({ channel: "WhatsApp", type: "Transactional", template: "Custom", identity: "9195784", payload: { to: "+919876543210", whatsapp: { media: { type: "audio", link: "https://x/a.ogg", caption: "no" } } } }, env), /caption/);
  await assert.rejects(async () => catzconnect.send({ channel: "WhatsApp", type: "Transactional", template: "Custom", identity: "9195784", payload: { to: "+919876543210", whatsapp: { media: { type: "image", link: "http://x/a.png" } } } }, env), /https/);
  await assert.rejects(async () => catzconnect.send({ channel: "WhatsApp", type: "Transactional", template: "promo", identity: "9195784", payload: { to: "+919876543210", whatsapp: { body: ["two\nlines"] } } }, env), /new lines/);
  await assert.rejects(async () => catzconnect.send({ channel: "WhatsApp", type: "Transactional", template: "promo", identity: "9195784", payload: { to: "+919876543210", whatsapp: { buttons: [{ index: 0, type: "url" }] } } }, env), /url button/);
  await assert.rejects(async () => catzconnect.send({ channel: "Email", type: "Transactional", template: "Custom", identity: "h", payload: { to: "a@b.co", subject: "s", body: "b", whatsapp: {} } }, env), /WhatsApp channel only/);
});

test("new error codes are on CatzApiError, with details", async () => {
  mockFetch(409, { success: false, message: "closed", code: "whatsapp_window_closed" });
  await assert.rejects(
    catzconnect.send({ channel: "WhatsApp", type: "Transactional", template: "Custom", identity: "919578456444", payload: { to: "+919876543210", body: "hi" } }, env),
    (e) => e.code === ErrorCodes.WHATSAPP_WINDOW_CLOSED && e.status === 409,
  );
  for (const c of ["organization_suspended", "sending_paused", "key_expired", "ip_not_allowed", "idempotency_conflict", "not_allowed_for_test_keys"]) {
    assert.ok(Object.values(ErrorCodes).includes(c), c);
  }
  assert.ok(isRetryableCode("sending_paused"));
  assert.ok(!isRetryableCode("key_expired"));
  const err = CatzApiError.from(400, JSON.stringify({ success: false, message: "wrong", code: "otp_invalid", attempts_remaining: 2 }));
  assert.equal(err.details.attempts_remaining, 2);
});

test("messages.get / list", async () => {
  mockFetch(200, { success: true, message: "Success", data: { message_id: ID, channel: "sms", status: "delivered", events: [{ type: "queued", at: "x" }] } });
  const m = await catzconnect.messages.get(ID, env);
  assert.equal(m.status, "delivered");
  assert.equal(calls[0].url, "https://api.test/sdk/messages/get");
  assert.equal(calls[0].body.message_id, ID);
  await assert.rejects(catzconnect.messages.get("nope", env), /UUID/);

  mockFetch(200, { success: true, message: "Success", data: { messages: [{ message_id: ID }], next_before: null } });
  const l = await catzconnect.messages.list({ recipient: "+15550100", channel: "SMS", limit: 5 }, env);
  assert.equal(l.messages.length, 1);
  assert.deepEqual({ ...calls[0].body, ts: 0 }, { recipient: "+15550100", channel: "sms", limit: 5, ts: 0 });
  assert.throws(() => buildListMessagesPayload({}), /recipient/);
  assert.throws(() => buildListMessagesPayload({ reference: "x", limit: 500 }), /limit/);
});

test("otp.start / verify", async () => {
  assert.deepEqual(buildOtpStartPayload({ channel: "sms", to: "+15550100", codeLength: 8, reference: "signup" }),
    { channel: "SMS", to: "+15550100", code_length: 8, reference: "signup" });
  assert.throws(() => buildOtpStartPayload({ channel: "push", to: "x" }), /channel/);
  assert.throws(() => buildOtpStartPayload({ channel: "Email", to: "a@b.co", ttlSeconds: 10 }), /ttl_seconds/);
  assert.deepEqual(buildOtpVerifyPayload({ verificationId: ID, code: "123 456" }), { verification_id: ID, code: "123456" });
  assert.deepEqual(buildOtpVerifyPayload({ channel: "email", to: "a@b.co", code: "1234" }), { channel: "Email", to: "a@b.co", code: "1234" });
  assert.throws(() => buildOtpVerifyPayload({ code: "1234" }), /verificationId/);

  mockFetch(200, { success: true, message: "Success", data: { verification_id: ID, status: "pending", test: true, code: "123456" } });
  const s = await catzconnect.otp.start({ channel: "Email", to: "a@b.co", identity: "hello" }, env);
  assert.equal(s.code, "123456");
  assert.equal(calls[0].url, "https://api.test/sdk/otp/start");

  mockFetch(400, { success: false, message: "The code is not correct", code: "otp_invalid", attempts_remaining: 4 });
  await assert.rejects(catzconnect.otp.verify({ verificationId: ID, code: "000000" }, env), (e) => e.code === "otp_invalid" && e.details.attempts_remaining === 4);
});

test("manage.* posts to /sdk/manage/{resource}/{op}", async () => {
  mockFetch(200, { success: true, message: "API key created", data: { id: ID, api_key: "k", private_key: "p", server_public_key: "s", api_key_short: "…k" } });
  const k = await catzconnect.manage.keys.create({ name: "CI", kind: "test", channels: ["Email"] }, env);
  assert.equal(k.api_key, "k");
  assert.equal(calls[0].url, "https://api.test/sdk/manage/keys/create");
  assert.equal(calls[0].body.kind, "test");
  assert.throws(() => catzconnect.manage.keys.create({ name: "x", kind: "app" }, env), /server or test/);

  mockFetch(200, { success: true, message: "ok", data: { templates: [] } });
  await catzconnect.manage.templates.list("SMS", env);
  assert.equal(calls[0].url, "https://api.test/sdk/manage/templates/list");
  assert.equal(calls[0].body.channel, "SMS");

  mockFetch(200, { success: true, message: "ok", data: {} });
  await catzconnect.manage.suppressions.add("email", "a@b.co", undefined, env);
  assert.deepEqual({ ...calls[0].body, ts: 0 }, { channel: "email", address: "a@b.co", ts: 0 });
  await catzconnect.manage.templates.saveVariant({ template_id: ID, language: "de", body: "Hallo" }, env);
  assert.equal(calls.at(-1).url, "https://api.test/sdk/manage/templates/variant_save");
  assert.throws(() => catzconnect.manage.webhooks.save({ url: "https://h", events: [] }, env), /event/);

  mockFetch(403, { success: false, message: "no", code: "management_scope_required" });
  await assert.rejects(catzconnect.manage.webhooks.list(env), (e) => e.code === ErrorCodes.MANAGEMENT_SCOPE_REQUIRED);
});

test("pushDevices uses plain JSON with the publishable key, no API key", async () => {
  const token = "t".repeat(40);
  mockFetch(200, { success: true, message: "Device registered", data: { device_id: ID, created: true } }, { encrypted: false });
  const r = await catzconnect.pushDevices.register({ publishableKey: "pk_push_abcdef", token, platform: "web", externalUserId: "u1", userHash: "h" });
  assert.deepEqual(r, { device_id: ID, created: true });
  assert.equal(calls[0].url, "https://api.test/push/register");
  assert.equal(calls[0].init.headers.Authorization, undefined);
  assert.deepEqual(calls[0].body, { publishable_key: "pk_push_abcdef", token, platform: "web", external_user_id: "u1", user_hash: "h" });

  mockFetch(200, { success: true, message: "ok", data: { removed: true } }, { encrypted: false });
  assert.deepEqual(await catzconnect.pushDevices.unregister("pk_push_abcdef", token), { removed: true });
  mockFetch(200, { success: true, message: "ok", data: { recorded: true } }, { encrypted: false });
  assert.deepEqual(await catzconnect.pushDevices.opened("pk_push_abcdef", ID), { recorded: true });
  assert.equal(calls[0].url, "https://api.test/push/opened");
  assert.equal(JSON.parse(calls[0].init.body).token, undefined, "legacy call: no token");
  mockFetch(200, { success: true, message: "ok", data: { recorded: true, verified: true } }, { encrypted: false });
  assert.deepEqual(await catzconnect.pushDevices.opened("pk_push_abcdef", ID, token), { recorded: true, verified: true });
  assert.equal(JSON.parse(calls[0].init.body).token, token);
  await assert.rejects(() => catzconnect.pushDevices.opened("pk_push_abcdef", ID, "short"), /token/);
  assert.throws(() => buildRegisterDevicePayload({ publishableKey: "pk_push_abcdef", token: "short", platform: "web" }), /token/);
  assert.throws(() => buildRegisterDevicePayload({ publishableKey: "pk_push_abcdef", token, platform: "tv" }), /platform/);
});

test("parseWebhookEvent verifies and flags test events", () => {
  const body = JSON.stringify({ id: "e1", type: "sms.delivered", created_at: "x", organization_id: "o", test: true, data: { message_id: ID, test: true } });
  const t = 1700000000;
  const sig = createHmac("sha256", "whsec_test").update(`${t}.${body}`).digest("hex");
  const ev = parseWebhookEvent(body, `t=${t},v1=${sig}`, "whsec_test", 300, t);
  assert.equal(ev.type, "sms.delivered");
  assert.equal(ev.test, true);
  assert.equal(ev.data.message_id, ID);
  assert.throws(() => parseWebhookEvent(body, `t=${t},v1=${sig}`, "other", 300, t), /signature/);
  assert.ok(WEBHOOK_EVENTS.includes("whatsapp.read"));
  assert.ok(WEBHOOK_EVENTS.includes("email.received"));
});

// ─── cross-channel features (opt-outs per channel, topics, push broadcasts) ──

test("email topic is sent as is, and only on Email", async () => {
  const base = { channel: "Email", type: "Transactional", template: "Custom", identity: "h", payload: { to: "a@b.co", subject: "s", body: "b", topic: "newsletter" } };
  assert.equal(buildSendPayload(base).topic, "newsletter");
  await assert.rejects(catzconnect.send({ ...base, payload: { ...base.payload, topic: "News Letter" } }, env), /topic key/);
  await assert.rejects(
    catzconnect.send({ channel: "SMS", type: "Transactional", template: "Custom", identity: "", payload: { to: "+15550100", body: "x", topic: "newsletter" } }, env),
    /Email channel only/,
  );
  for (const c of ["invalid_topic", "topic_email_only", "recipient_suppressed", "not_cancelable", "not_resendable", "whatsapp_opted_out", "content_gone"]) {
    assert.ok(Object.values(ErrorCodes).includes(c), c);
  }
});

test("push broadcast / topic / send_at answer with a broadcast_id", async () => {
  const push = (payload) => ({ channel: "Push", type: "Notification", template: "Notification", identity: "my-firebase", payload });
  mockFetch(200, { success: true, message: "Scheduled", data: { broadcast_id: ID, audience: "topic", status: "scheduled", send_at: "2026-11-02T09:00:00Z" } });
  const res = await catzconnect.send(push({ body: "Sale", push: { topic: "deals", send_at: new Date("2026-11-02T09:00:00Z") } }), env);
  assert.equal(res.data.broadcast_id, ID);
  assert.deepEqual(calls[0].body.push, { topic: "deals", send_at: "2026-11-02T09:00:00.000Z" });
  assert.equal(calls[0].body.to, undefined);

  mockFetch(200, { success: true, message: "Success", data: { broadcast_id: ID, audience: "all", status: "scheduled" } });
  await catzconnect.send(push({ body: "Hi all", push: { broadcast: true } }), env);
  assert.deepEqual(calls[0].body.push, { broadcast: true });
  // A scheduled push to one token keeps `to`.
  const token = "t".repeat(40);
  assert.equal(buildSendPayload(push({ to: token, body: "x", push: { send_at: "2026-11-02T09:00:00+02:00" } })).to, token);

  await assert.rejects(catzconnect.send(push({ to: token, body: "x", push: { broadcast: true } }), env), /leave 'to'/);
  await assert.rejects(catzconnect.send(push({ body: "x", push: { broadcast: true, topic: "a" } }), env), /not both/);
  await assert.rejects(catzconnect.send(push({ body: "x", push: { topic: "a/b" } }), env), /push.topic/);
  await assert.rejects(catzconnect.send(push({ body: "x", push: { broadcast: true, send_at: "2026-11-02 09:00" } }), env), /RFC 3339/);
  await assert.rejects(catzconnect.send(push({ body: "x", push: { topic: "a" }, device_key: "k" }), env), /device_key/);
  await assert.rejects(
    catzconnect.send({ channel: "Email", type: "Transactional", template: "Custom", identity: "h", payload: { to: "a@b.co", subject: "s", body: "b", push: { broadcast: true } } }, env),
    /Push channel only/,
  );
});

test("push.* posts to /sdk/push/*", async () => {
  mockFetch(200, { success: true, message: "Success", data: { id: ID, status: "dispatching", queued: 500 } });
  const b = await catzconnect.push.broadcast(ID, env);
  assert.equal(b.queued, 500);
  assert.equal(calls[0].url, "https://api.test/sdk/push/broadcast");
  assert.equal(calls[0].body.broadcast_id, ID);

  mockFetch(200, { success: true, message: "Broadcast canceled", data: { broadcast_id: ID, status: "canceled" } });
  assert.equal((await catzconnect.push.cancel(ID, env)).status, "canceled");
  assert.equal(calls[0].url, "https://api.test/sdk/push/cancel");
  await assert.rejects(catzconnect.push.cancel("x", env), /UUID/);

  const token = "t".repeat(40);
  mockFetch(200, { success: true, message: "Subscribed", data: { topic: "deals", devices: 2 } });
  assert.equal((await catzconnect.push.subscribe({ identity: "my-firebase", topic: "deals", tokens: [token], externalUserId: "u1" }, env)).devices, 2);
  assert.equal(calls[0].url, "https://api.test/sdk/push/topic/subscribe");
  assert.deepEqual({ ...calls[0].body, ts: 0 }, { identity: "my-firebase", topic: "deals", tokens: [token], external_user_id: "u1", ts: 0 });
  mockFetch(200, { success: true, message: "Unsubscribed", data: { topic: "deals", devices: 1 } });
  await catzconnect.push.unsubscribe({ identity: "my-firebase", topic: "deals", externalUserId: "u1" }, env);
  assert.equal(calls[0].url, "https://api.test/sdk/push/topic/unsubscribe");
  assert.throws(() => buildPushTopicChangePayload({ identity: "p", topic: "deals" }), /tokens/);
  assert.throws(() => buildPushTopicChangePayload({ identity: "p", topic: "bad topic", externalUserId: "u" }), /push topic/);

  mockFetch(200, { success: true, message: "Success", data: { topics: [{ topic: "deals", devices: 2 }] } });
  assert.equal((await catzconnect.push.topics("my-firebase", env)).topics[0].topic, "deals");
  assert.equal(calls[0].url, "https://api.test/sdk/push/topics");

  mockFetch(403, { success: false, message: "no", code: "not_allowed_for_test_keys" });
  await assert.rejects(catzconnect.push.topics("my-firebase", env), (e) => e.code === ErrorCodes.NOT_ALLOWED_FOR_TEST_KEYS);
});

test("pushDevices topics use the publishable key", async () => {
  const token = "t".repeat(40);
  mockFetch(200, { success: true, message: "ok", data: { topics: ["deals", "news"] } }, { encrypted: false });
  assert.deepEqual(await catzconnect.pushDevices.subscribeTopics("pk_push_abcdef", token, ["deals", "news"]), { topics: ["deals", "news"] });
  assert.equal(calls[0].url, "https://api.test/push/topics/subscribe");
  assert.deepEqual(calls[0].body, { publishable_key: "pk_push_abcdef", token, topics: ["deals", "news"] });
  mockFetch(200, { success: true, message: "ok", data: { topics: [] } }, { encrypted: false });
  await catzconnect.pushDevices.unsubscribeTopics("pk_push_abcdef", token, ["deals"]);
  assert.equal(calls[0].url, "https://api.test/push/topics/unsubscribe");
  await assert.rejects(catzconnect.pushDevices.subscribeTopics("pk_push_abcdef", token, []), /topics/);
  await assert.rejects(catzconnect.pushDevices.subscribeTopics("pk_push_abcdef", token, Array(21).fill("a")), /topics/);
});

test("messages: broadcast deliveries and resend lineage", async () => {
  assert.deepEqual(buildListMessagesPayload({ broadcastId: ID, limit: 50 }), { broadcast_id: ID, limit: 50 });
  assert.throws(() => buildListMessagesPayload({ broadcastId: "x" }), /UUID/);
  mockFetch(200, { success: true, message: "Success", data: { message_id: ID, channel: "sms", status: "failed", resent_from: null,
    events: [{ type: "queued", at: "a" }, { type: "failed", at: "b" }, { type: "resent", at: "c", detail: ID }] } });
  const m = await catzconnect.messages.get(ID, env);
  assert.equal(m.events.at(-1).type, "resent");
});

test("manage.suppressions: every channel, topics, remove by id", async () => {
  mockFetch(200, { success: true, message: "ok", data: {} });
  await catzconnect.manage.suppressions.add("whatsapp", "+919876543210", { detail: "asked us" }, env);
  assert.deepEqual({ ...calls[0].body, ts: 0 }, { channel: "whatsapp", address: "+919876543210", detail: "asked us", ts: 0 });
  await catzconnect.manage.suppressions.add("email", "a@b.co", { topic: "newsletter" }, env);
  assert.equal(calls.at(-1).body.topic, "newsletter");
  await catzconnect.manage.suppressions.add("push", "user-42", "legacy detail string", env);
  assert.equal(calls.at(-1).body.detail, "legacy detail string");
  assert.throws(() => catzconnect.manage.suppressions.add("sms", "+15550100", { topic: "newsletter" }, env), /email suppressions only/);
  await catzconnect.manage.suppressions.remove({ id: ID }, undefined, env);
  assert.deepEqual({ ...calls.at(-1).body, ts: 0 }, { id: ID, ts: 0 });
  await catzconnect.manage.suppressions.remove("+15550100", "voice", env);
  assert.deepEqual({ ...calls.at(-1).body, ts: 0 }, { address: "+15550100", channel: "voice", ts: 0 });
  await catzconnect.manage.suppressions.remove({ channel: "email", address: "a@b.co", topic: "newsletter" }, undefined, env);
  assert.equal(calls.at(-1).body.topic, "newsletter");
  await catzconnect.manage.suppressions.list({ channel: "push", topic: undefined }, env);
  assert.equal(calls.at(-1).url, "https://api.test/sdk/manage/suppressions/list");
});

test("webhook events include the cross-channel events", () => {
  for (const e of ["email.complained", "email.unsubscribed", "push.opened", "sms.inbound", "sms.opt_out", "whatsapp.opt_out"]) {
    assert.ok(WEBHOOK_EVENTS.includes(e), e);
  }
  // No in-call chat events: chat and data stay inside the call.
  assert.ok(!WEBHOOK_EVENTS.some((e) => e.startsWith("call.chat") || e.startsWith("call.data")));
});

test("send() errors keep the API error's details", async () => {
  mockFetch(409, { success: false, message: "busy", code: "idempotency_in_progress", retry_after: 3 });
  await assert.rejects(
    catzconnect.send({ channel: "Email", type: "Transactional", template: "Custom", identity: "h", payload: { to: "a@b.co", subject: "s", body: "b" }, idempotencyKey: "k-1" }, env),
    (e) => e.code === "idempotency_in_progress" && e.status === 409 && e.details?.retry_after === 3 && e.cause?.details?.retry_after === 3,
  );
});
